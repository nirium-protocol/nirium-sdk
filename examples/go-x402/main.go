// Command go-x402 pays an x402 v2 endpoint using a Stellar auth-entry builder.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	url, secret := os.Getenv("X402_URL"), os.Getenv("STELLAR_SECRET_KEY")
	if url == "" || secret == "" {
		log.Fatal("set X402_URL and STELLAR_SECRET_KEY")
	}
	// Supply your Soroban auth-entry builder here. It must build the exact SAC
	// transfer, sign its authorization entry with the official Stellar Go SDK,
	// and return the resulting transaction XDR. Never print secret.
	signer, err := NewStellarSigner(secret, nil)
	if err != nil {
		log.Fatal(err)
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		log.Fatal(err)
	}
	resp, err := (Client{Network: "stellar:testnet", Signer: signer}).Do(context.Background(), req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	fmt.Println(resp.Status)
}
