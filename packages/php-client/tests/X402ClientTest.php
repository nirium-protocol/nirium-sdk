<?php

namespace Nirium\X402\Tests;

use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Nirium\X402\X402Client;
use PHPUnit\Framework\TestCase;

class X402ClientTest extends TestCase {
    public function testFetchHandles402AndRetriesWithPaymentSignature() {
        // Mock a 402 Payment Required response for the first request
        // and a 200 OK for the retry request.
        $friendbot = new Client();
        
        $payToAccount = \Soneso\StellarSDK\Crypto\KeyPair::random()->getAccountId();
        
        // Fund payTo account so the token transfer doesn't fail with 'account entry is missing'
        $friendbot->request('GET', 'https://friendbot.stellar.org/?addr=' . $payToAccount);

        $paymentRequiredPayload = [
            'accepts' => [
                [
                    'scheme' => 'exact',
                    'payTo' => $payToAccount,
                    'asset' => 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // XLM on testnet
                    'amount' => '1000',
                ]
            ]
        ];
        
        $mock = new MockHandler([
            new Response(402, ['payment-required' => base64_encode(json_encode($paymentRequiredPayload))]),
            new Response(200, [], 'Success!')
        ]);

        $handlerStack = HandlerStack::create($mock);
        $httpClient = new Client(['handler' => $handlerStack, 'http_errors' => false]);

        $secret = \Soneso\StellarSDK\Crypto\KeyPair::random();
        $accountId = $secret->getAccountId();
        
        // Fund the account with Friendbot for the test
        $friendbot->request('GET', 'https://friendbot.stellar.org/?addr=' . $accountId);

        $client = new X402Client([
            'secretKey' => $secret->getSecretSeed(),
            'network' => 'stellar:testnet',
            'httpClient' => $httpClient,
        ]);

        $response = $client->fetch('https://example.com/api/premium');

        $this->assertEquals(200, $response->getStatusCode());
        $this->assertEquals('Success!', (string)$response->getBody());
        
        // Assert that the second request had the PAYMENT-SIGNATURE header
        $retryRequest = $mock->getLastRequest();
        $this->assertTrue($retryRequest->hasHeader('PAYMENT-SIGNATURE'));
        
        $paymentSignatureHeader = $retryRequest->getHeaderLine('PAYMENT-SIGNATURE');
        $decoded = json_decode(base64_decode($paymentSignatureHeader), true);
        
        $this->assertEquals(2, $decoded['x402Version']);
        $this->assertEquals('exact', $decoded['accepted']['scheme']);
        $this->assertArrayHasKey('transaction', $decoded['payload']);
    }
}
