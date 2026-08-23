<?php
require __DIR__ . '/vendor/autoload.php';
$secret = \Soneso\StellarSDK\Crypto\KeyPair::random();
$accountId = $secret->getAccountId();
echo "Generated account: $accountId\n";
$friendbot = new \GuzzleHttp\Client();
$friendbot->request('GET', 'https://friendbot.stellar.org/?addr=' . $accountId);
putenv("STELLAR_SECRET_KEY=" . $secret->getSecretSeed());
include 'examples/pay.php';
