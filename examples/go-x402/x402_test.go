package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func challengeHeader(t *testing.T) string {
	t.Helper()
	c := Challenge{X402Version: 2, Accepts: []Requirement{{Scheme: "exact", Network: "stellar:testnet", Asset: "CBIEL", Amount: "20000", PayTo: "GDEST", MaxTimeoutSeconds: 300}}}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestParseChallengeAndPaymentHeader(t *testing.T) {
	c, err := ParseChallenge(challengeHeader(t))
	if err != nil {
		t.Fatal(err)
	}
	a, err := SelectExactStellar(c, "stellar:testnet")
	if err != nil {
		t.Fatal(err)
	}
	h, err := PaymentHeader(c, a, "AAAA-signed-xdr")
	if err != nil {
		t.Fatal(err)
	}
	b, err := base64.StdEncoding.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	var got Payment
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.X402Version != 2 || got.Accepted.Amount != "20000" || got.Payload.Transaction != "AAAA-signed-xdr" {
		t.Fatalf("unexpected credential: %+v", got)
	}
}

type stubSigner struct{}

func (stubSigner) SignExact(context.Context, Requirement) (string, error) { return "signed-xdr", nil }

func TestClientRetriesWithPaymentSignature(t *testing.T) {
	challenge := challengeHeader(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PAYMENT-SIGNATURE") == "" {
			w.Header().Set("payment-required", challenge)
			w.WriteHeader(http.StatusPaymentRequired)
			return
		}
		if r.Header.Get("X-PAYMENT") != "" {
			t.Error("sent obsolete X-PAYMENT header")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	req, err := http.NewRequest(http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := (Client{Network: "stellar:testnet", Signer: stubSigner{}}).Do(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}
