use thiserror::Error;

#[derive(Error, Debug)]
pub enum X402Error {
    #[error("missing payment-required header")]
    MissingHeader,
    #[error("decode payment-required header: {0}")]
    Decode(String),
    #[error("parse payment-required header: {0}")]
    Parse(String),
    #[error("unsupported x402 version {0}")]
    UnsupportedVersion(i64),
    #[error("challenge has no accepted payment methods")]
    NoAccepts,
    #[error("no exact payment requirement for network {0}")]
    NoExactForNetwork(String),
    #[error("empty signed transaction")]
    EmptyTransaction,
    #[error("sign payment: {0}")]
    Sign(String),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("parse URL: {0}")]
    Url(#[from] url::ParseError),
    #[error("secret key: {0}")]
    Secret(String),
    #[error("mock server test failed: {0}")]
    MockTest(String),
}

pub type Result<T> = std::result::Result<T, X402Error>;
