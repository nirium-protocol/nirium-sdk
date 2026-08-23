<?php

namespace Nirium\X402;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\ClientException;
use Soneso\StellarSDK\Crypto\KeyPair;
use Soneso\StellarSDK\Network;
use Soneso\StellarSDK\Soroban\Address;
use Soneso\StellarSDK\Soroban\Contract\AssembledTransaction;
use Soneso\StellarSDK\Soroban\Contract\AssembledTransactionOptions;
use Soneso\StellarSDK\Soroban\Contract\ClientOptions;
use Soneso\StellarSDK\Soroban\SorobanServer;
use Soneso\StellarSDK\Xdr\XdrInt128Parts;
use Soneso\StellarSDK\Xdr\XdrSCVal;

class X402Client {
    private KeyPair $keyPair;
    private Network $network;
    private Client $httpClient;
    private SorobanServer $sorobanServer;
    private string $rpcUrl;

    public function __construct(array $config = []) {
        $secret = $config['secretKey'] ?? getenv('STELLAR_SECRET_KEY') ?: null;
        if (!$secret) {
            throw new \InvalidArgumentException("Stellar secret key is required via config or STELLAR_SECRET_KEY env var");
        }
        $this->keyPair = KeyPair::fromSeed($secret);
        
        $networkStr = $config['network'] ?? getenv('STELLAR_NETWORK') ?: 'stellar:testnet';
        $this->network = $networkStr === 'stellar:pubnet' ? Network::public() : Network::testnet();
        
        $this->httpClient = $config['httpClient'] ?? new Client(['http_errors' => false]);
        
        $this->rpcUrl = $networkStr === 'stellar:testnet' 
            ? 'https://soroban-testnet.stellar.org' 
            : 'https://soroban-rpc.mainnet.stellar.gateway.fm';
            
        $this->sorobanServer = new SorobanServer($this->rpcUrl);
    }

    public function fetch(string $url, array $options = []): \Psr\Http\Message\ResponseInterface {
        try {
            $response = $this->httpClient->request('GET', $url, $options);
        } catch (ClientException $e) {
            $response = $e->getResponse();
        }

        if ($response && $response->getStatusCode() === 402) {
            $paymentRequiredHeader = $response->getHeaderLine('payment-required');
            if (!$paymentRequiredHeader) {
                return $response;
            }

            $paymentRequired = json_decode(base64_decode($paymentRequiredHeader), true);
            if (!isset($paymentRequired['accepts'])) {
                return $response;
            }

            $exactScheme = null;
            foreach ($paymentRequired['accepts'] as $accepts) {
                if (($accepts['scheme'] ?? '') === 'exact') {
                    $exactScheme = $accepts;
                    break;
                }
            }

            if (!$exactScheme) {
                throw new \Exception("No 'exact' scheme found in 402 challenge");
            }

            // Extract exact scheme details
            $payTo = $exactScheme['payTo'];
            $asset = $exactScheme['asset'];
            $amount = $exactScheme['amount'];
            
            // Build Soroban AssembledTransaction manually to avoid using our keyPair as invoker
            $dummyInvoker = \Soneso\StellarSDK\Crypto\KeyPair::random();
            $dummyAccount = new \Soneso\StellarSDK\Account($dummyInvoker->getAccountId(), new \phpseclib3\Math\BigInteger("0"));

            $invokeContractHostFunction = new \Soneso\StellarSDK\InvokeContractHostFunction(
                $asset,
                'transfer',
                [
                    Address::fromAccountId($this->keyPair->getAccountId())->toXdrSCVal(), // from
                    Address::fromAccountId($payTo)->toXdrSCVal(), // to
                    XdrSCVal::forI128($this->parseAmount($amount)) // amount
                ]
            );
            $builder = new \Soneso\StellarSDK\InvokeHostFunctionOperationBuilder($invokeContractHostFunction);

            $txBuilder = new \Soneso\StellarSDK\TransactionBuilder($dummyAccount);
            $txBuilder->addOperation($builder->build());
            $tx = $txBuilder->build();

            // Simulate the transaction
            $simulateRequest = new \Soneso\StellarSDK\Soroban\Requests\SimulateTransactionRequest($tx);
            $simulationResponse = $this->sorobanServer->simulateTransaction($simulateRequest);

            if ($simulationResponse->error !== null) {
                throw new \Exception("Simulation failed: " . $simulationResponse->error);
            }

            if ($simulationResponse->transactionData !== null) {
                $tx->setSorobanTransactionData($simulationResponse->transactionData);
                $tx->addResourceFee($simulationResponse->minResourceFee);
                
                $authEntries = $simulationResponse->getSorobanAuth();
                
                // Sign the auth entries
                $expirationLedger = $this->sorobanServer->getLatestLedger()->sequence + \Soneso\StellarSDK\Constants\StellarConstants::DEFAULT_LEDGER_EXPIRATION_OFFSET;

                foreach ($authEntries as $entry) {
                    $credType = $entry->credentials->credentialType;
                    if ($credType === \Soneso\StellarSDK\Xdr\XdrSorobanCredentialsType::SOROBAN_CREDENTIALS_ADDRESS) {
                        $topCreds = $entry->credentials->getAddressCredentials();
                        if ($topCreds !== null) {
                            $topCreds->signatureExpirationLedger = $expirationLedger;
                            $entry->credentials->writeBackAddressCredentials($topCreds);
                            $entry->sign($this->keyPair, $this->network);
                        }
                    }
                }
                
                $tx->setSorobanAuth($authEntries);
            } else {
                throw new \Exception("Simulation did not return transaction data. Response: " . print_r($simulationResponse, true));
            }

            // Serialize the transaction to XDR and base64 encode
            $txXdr = base64_encode($tx->toXdr()->encode());

            $paymentPayload = [
                'x402Version' => 2,
                'accepted' => $exactScheme,
                'payload' => [
                    'transaction' => $txXdr
                ]
            ];

            $paymentSignatureHeader = base64_encode(json_encode($paymentPayload));

            // Retry original request with PAYMENT-SIGNATURE
            $retryOptions = array_merge_recursive($options, [
                'headers' => [
                    'PAYMENT-SIGNATURE' => $paymentSignatureHeader
                ]
            ]);

            return $this->httpClient->request('GET', $url, $retryOptions);
        }

        return $response;
    }

    private function parseAmount(string $amount): XdrInt128Parts {
        return \Soneso\StellarSDK\Xdr\XdrInt128Parts::fromJsonValue($amount);
    }
}
