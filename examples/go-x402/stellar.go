package main

import (
	"context"
	"fmt"

	"github.com/stellar/go/keypair"
)

// StellarSigner owns a server-side Stellar key. The key is parsed through the
// official Stellar Go SDK and is never exposed by this package.
//
// The x402 Stellar exact scheme requires an auth-entry builder in addition to a
// keypair. Keep that concern injectable so applications can use their approved
// Soroban RPC/facilitator integration while the HTTP negotiation remains small.
type StellarSigner struct {
	keypair keypair.KP
	Build   func(context.Context, Requirement, keypair.KP) (string, error)
}

// NewStellarSigner validates secret with github.com/stellar/go. Build must
// return a base64 transaction XDR containing the signed Soroban auth entry.
func NewStellarSigner(secret string, build func(context.Context, Requirement, keypair.KP) (string, error)) (*StellarSigner, error) {
	kp, err := keypair.Parse(secret)
	if err != nil {
		return nil, fmt.Errorf("parse Stellar secret: %w", err)
	}
	if build == nil {
		return nil, fmt.Errorf("x402: auth-entry builder is required")
	}
	return &StellarSigner{keypair: kp, Build: build}, nil
}

func (s *StellarSigner) SignExact(ctx context.Context, accepted Requirement) (string, error) {
	return s.Build(ctx, accepted, s.keypair)
}
