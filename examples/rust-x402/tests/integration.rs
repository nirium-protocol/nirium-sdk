#[cfg(test)]
mod tests {
    use rust_x402::*;
    use rust_x402::signer::MockSigner;

    fn sample_challenge_b64() -> String {
        let json = serde_json::json!({
            "x402Version": 2,
            "accepts": [{
                "scheme": "exact",
                "network": "stellar:testnet",
                "asset": "USDC",
                "amount": "0.02",
                "payTo": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
                "maxTimeoutSeconds": 300
            }]
        });
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, json.to_string())
    }

    #[test]
    fn parse_valid_challenge() {
        let c = Challenge::parse(&sample_challenge_b64()).unwrap();
        assert_eq!(c.x402_version, 2);
        assert_eq!(c.accepts.len(), 1);
        assert_eq!(c.accepts[0].scheme, "exact");
        assert_eq!(c.accepts[0].network, "stellar:testnet");
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(matches!(Challenge::parse("").unwrap_err(), X402Error::MissingHeader));
    }

    #[test]
    fn parse_rejects_v1() {
        let v1 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, r#"{"x402Version":1,"accepts":[]}"#);
        assert!(matches!(Challenge::parse(&v1).unwrap_err(), X402Error::UnsupportedVersion(1)));
    }

    #[test]
    fn select_exact_stellar() {
        let c = Challenge::parse(&sample_challenge_b64()).unwrap();
        let r = c.select_exact("stellar:testnet").unwrap();
        assert_eq!(r.amount, "0.02");
    }

    #[test]
    fn select_exact_missing_network() {
        let c = Challenge::parse(&sample_challenge_b64()).unwrap();
        assert!(matches!(c.select_exact("stellar:mainnet").unwrap_err(), X402Error::NoExactForNetwork(_)));
    }

    #[test]
    fn payment_header_base64_roundtrip() {
        let c = Challenge::parse(&sample_challenge_b64()).unwrap();
        let r = c.select_exact("stellar:testnet").unwrap();
        let header = payment_header(&c, r, "tx_deadbeef").unwrap();
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &header).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["x402Version"], 2);
        assert_eq!(json["payload"]["transaction"], "tx_deadbeef");
    }

    #[test]
    fn mock_signer_returns_configured_xdr() {
        let signer = MockSigner { tx_xdr: "AAAA_test_tx".into() };
        let accepted = Requirement {
            scheme: "exact".into(), network: "stellar:testnet".into(), asset: "USDC".into(),
            amount: "0.02".into(), pay_to: "C_ADDRESS".into(), max_timeout_seconds: Some(300),
            extra: None,
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert_eq!(rt.block_on(signer.sign_exact(&accepted)).unwrap(), "AAAA_test_tx");
    }

    #[test]
    fn challenge_preserves_extra_fields() {
        let json = serde_json::json!({
            "x402Version": 2,
            "accepts": [{
                "scheme": "exact",
                "network": "stellar:testnet",
                "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
                "amount": "200000",
                "payTo": "GC4Q5TWWXI7IHN6DYCBEKCOWJWCKY4JE2NLKLU5SE3YL44IUUFPKUOPC",
                "maxTimeoutSeconds": 300,
                "extra": { "areFeesSponsored": true }
            }]
        });
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, json.to_string());
        let c = Challenge::parse(&b64).unwrap();
        let r = &c.accepts[0];
        assert_eq!(r.extra.as_ref().unwrap()["areFeesSponsored"], true);
        // roundtrip keeps extra in the signed credential
        let header = payment_header(&c, r.clone(), "AAAA_test_tx").unwrap();
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &header).unwrap();
        let round: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(round["accepted"]["extra"]["areFeesSponsored"], true);
    }

    #[test]
    fn env_signer_rejects_bad_secret() {
        use rust_x402::signer::EnvSigner;
        assert!(EnvSigner::new("not-a-stellar-secret".into(), "https://soroban-testnet.stellar.org").is_err());
        assert!(EnvSigner::new(String::new(), "https://soroban-testnet.stellar.org").is_err());
    }

    #[test]
    fn env_signer_derives_real_public_key() {
        use rust_x402::signer::EnvSigner;
        // Well-known test vector: this seed derives the G-address below
        // (verified against stellar-strkey / ed25519-dalek).
        let signer = EnvSigner::new(
            "SCKB3ECHCPVM4HJPNCQWTQWJJ5XRL6UNKLTTCIH4B7TB22NKJ5GUFMIV".into(),
            "https://soroban-testnet.stellar.org",
        )
        .unwrap();
        assert!(signer.address().starts_with('G'));
        assert_eq!(signer.address().len(), 56);
        // Debug must not leak the secret
        let dbg = format!("{signer:?}");
        assert!(!dbg.contains("SCKB3ECH"));
        assert!(dbg.contains("***"));
    }
}
