#!/bin/bash
ACCOUNT_KEY=$(curl -s "https://friendbot.stellar.org/generate" | grep -o '"secret":"[^"]*' | cut -d'"' -f4)
ACCOUNT_ID=$(curl -s "https://friendbot.stellar.org/generate" | grep -o '"public_key":"[^"]*' | cut -d'"' -f4)
echo "Generated account: $ACCOUNT_ID"
curl -s "https://friendbot.stellar.org/?addr=$ACCOUNT_ID" > /dev/null
export STELLAR_SECRET_KEY=$ACCOUNT_KEY
docker run --rm -v $(pwd):/app -w /app -e STELLAR_SECRET_KEY=$ACCOUNT_KEY php-stellar-env php examples/pay.php
