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
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert_eq!(rt.block_on(signer.sign_exact(&accepted)).unwrap(), "AAAA_test_tx");
    }
}
