// Command go-x402 implements the HTTP portion of the x402 v2 payment flow.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const (
	paymentRequiredHeader  = "payment-required"
	paymentSignatureHeader = "PAYMENT-SIGNATURE"
	stellarTestnet         = "stellar:testnet"
)

// Requirement is one payment method offered by an x402 server.
type Requirement struct {
	Scheme            string          `json:"scheme"`
	Network           string          `json:"network"`
	Asset             string          `json:"asset"`
	Amount            string          `json:"amount"`
	PayTo             string          `json:"payTo"`
	MaxTimeoutSeconds int             `json:"maxTimeoutSeconds"`
	Extra             json.RawMessage `json:"extra"`
}

// Challenge is the decoded value of a payment-required response header.
type Challenge struct {
	X402Version int           `json:"x402Version"`
	Accepts     []Requirement `json:"accepts"`
}

// ParseChallenge decodes the base64 JSON challenge sent in a 402 response.
func ParseChallenge(value string) (Challenge, error) {
	if value == "" {
		return Challenge{}, errors.New("x402: missing payment-required header")
	}
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return Challenge{}, fmt.Errorf("x402: decode payment-required header: %w", err)
	}
	var challenge Challenge
	if err := json.Unmarshal(raw, &challenge); err != nil {
		return Challenge{}, fmt.Errorf("x402: parse payment-required header: %w", err)
	}
	if challenge.X402Version != 2 {
		return Challenge{}, fmt.Errorf("x402: unsupported version %d", challenge.X402Version)
	}
	if len(challenge.Accepts) == 0 {
		return Challenge{}, errors.New("x402: challenge has no accepted payment methods")
	}
	return challenge, nil
}

// SelectExactStellar chooses an exact Stellar payment requirement for network.
func SelectExactStellar(challenge Challenge, network string) (Requirement, error) {
	for _, accepted := range challenge.Accepts {
		if accepted.Scheme == "exact" && accepted.Network == network {
			return accepted, nil
		}
	}
	return Requirement{}, fmt.Errorf("x402: no exact payment requirement for %s", network)
}

// Payment is the x402 v2 credential placed in PAYMENT-SIGNATURE.
type Payment struct {
	X402Version int         `json:"x402Version"`
	Accepted    Requirement `json:"accepted"`
	Payload     struct {
		Transaction string `json:"transaction"`
	} `json:"payload"`
}

// PaymentHeader serializes a v2 payment credential. It deliberately does not
// use X-PAYMENT: that header belongs to x402 v1 and is ignored by v2 servers.
func PaymentHeader(challenge Challenge, accepted Requirement, transaction string) (string, error) {
	if transaction == "" {
		return "", errors.New("x402: empty signed transaction")
	}
	payment := Payment{X402Version: challenge.X402Version, Accepted: accepted}
	payment.Payload.Transaction = transaction
	raw, err := json.Marshal(payment)
	if err != nil {
		return "", fmt.Errorf("x402: marshal payment credential: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// TransactionSigner creates the signed Soroban transaction XDR for an exact
// requirement. StellarSigner is the production implementation.
type TransactionSigner interface {
	SignExact(context.Context, Requirement) (string, error)
}

// Client retries one request after receiving an x402 v2 402 challenge.
type Client struct {
	HTTPClient *http.Client
	Network    string
	Signer     TransactionSigner
}

// Do sends req, signs an exact Stellar credential when required, and retries
// the same request with PAYMENT-SIGNATURE. The request body must be replayable.
func (c Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	if c.Signer == nil {
		return nil, errors.New("x402: signer is required")
	}
	if req.GetBody == nil && req.Body != nil {
		return nil, errors.New("x402: request body is not replayable")
	}
	hc := c.HTTPClient
	if hc == nil {
		hc = http.DefaultClient
	}
	first, err := hc.Do(req.WithContext(ctx))
	if err != nil || first.StatusCode != http.StatusPaymentRequired {
		return first, err
	}
	defer first.Body.Close()
	_, _ = io.Copy(io.Discard, first.Body)
	challenge, err := ParseChallenge(first.Header.Get(paymentRequiredHeader))
	if err != nil {
		return nil, err
	}
	network := c.Network
	if network == "" {
		network = stellarTestnet
	}
	accepted, err := SelectExactStellar(challenge, network)
	if err != nil {
		return nil, err
	}
	tx, err := c.Signer.SignExact(ctx, accepted)
	if err != nil {
		return nil, fmt.Errorf("x402: sign payment: %w", err)
	}
	header, err := PaymentHeader(challenge, accepted, tx)
	if err != nil {
		return nil, err
	}
	retry := req.Clone(ctx)
	if req.GetBody != nil {
		retry.Body, err = req.GetBody()
		if err != nil {
			return nil, fmt.Errorf("x402: rewind request body: %w", err)
		}
	} else {
		retry.Body = io.NopCloser(bytes.NewReader(nil))
	}
	retry.Header = req.Header.Clone()
	retry.Header.Set(paymentSignatureHeader, header)
	return hc.Do(retry)
}
