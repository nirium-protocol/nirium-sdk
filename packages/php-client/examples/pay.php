<?php

require __DIR__ . '/../vendor/autoload.php';

use Nirium\X402\X402Client;

$secretKey = getenv('STELLAR_SECRET_KEY');

if (!$secretKey) {
    echo "Please set STELLAR_SECRET_KEY environment variable.\n";
    exit(1);
}

// Ensure error reporting is on for the example
error_reporting(E_ALL);
ini_set('display_errors', '1');

echo "Initializing X402Client...\n";
$client = new X402Client([
    'secretKey' => $secretKey,
    'network' => 'stellar:testnet',
]);

$targetUrl = 'https://nirium-agent.fly.dev/api/v1/premium/signals';
echo "Fetching: $targetUrl\n";

try {
    $response = $client->fetch($targetUrl);
    
    echo "Status Code: " . $response->getStatusCode() . "\n";
    echo "Response Body: \n";
    echo $response->getBody() . "\n";
} catch (\Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
