use crate::{Result, X402Error};
use async_trait::async_trait;
use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use std::convert::{TryFrom, TryInto};
use std::str::FromStr;
use stellar_rpc_client::Client as RpcClient;
use stellar_strkey::ed25519::{PrivateKey, PublicKey};
use stellar_xdr::{
    AccountId, ContractId, Hash, HashIdPreimage, HashIdPreimageSorobanAuthorization, HostFunction,
    Int128Parts, InvokeContractArgs, InvokeHostFunctionOp, Limits, Memo, MuxedAccount, Operation,
    OperationBody, Preconditions, PublicKey as XdrPublicKey, ScAddress, ScBytes, ScMap, ScMapEntry,
    ScSymbol, ScVal, ScVec, SequenceNumber, SorobanAuthorizedInvocation, SorobanCredentials,
    TimeBounds, TimePoint, Transaction, TransactionEnvelope, TransactionExt, TransactionV1Envelope,
    Uint256, VecM, WriteXdr,
};

/// Default Soroban RPC for testnet.
pub const STELLAR_TESTNET_RPC_URL: &str = "https://soroban-testnet.stellar.org";
/// Testnet network passphrase.
pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
/// Base inclusion fee in stroops. The facilitator is the transaction source
/// and pays the real fee; this is the canonical client's BASE_FEE.
const BASE_FEE_STROOPS: u32 = 100;
/// Fallback maxTimeoutSeconds when the requirement omits it.
const DEFAULT_TIMEOUT_SECONDS: u64 = 300;
/// Assumed seconds per ledger for the auth-entry expiration math
/// (same assumption as the canonical @x402/stellar client).
const ESTIMATED_LEDGER_SECONDS: u64 = 5;
/// Dummy source account so the simulator emits ADDRESS credentials for the
/// payer instead of source-account credentials (matches @stellar/stellar-sdk
/// NULL_ACCOUNT). The facilitator replaces it with its own account when it
/// submits.
const NULL_ACCOUNT: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

#[async_trait]
pub trait StellarSigner: Send + Sync {
    /// Returns the base64 `TransactionEnvelope` XDR paying `accepted`.
    async fn sign_exact(&self, accepted: &crate::Requirement) -> Result<String>;
}

pub struct MockSigner {
    pub tx_xdr: String,
}

#[async_trait]
impl StellarSigner for MockSigner {
    async fn sign_exact(&self, _accepted: &crate::Requirement) -> Result<String> {
        if self.tx_xdr.is_empty() {
            return Err(X402Error::Sign("empty mock tx".into()));
        }
        Ok(self.tx_xdr.clone())
    }
}

/// Ed25519 signer that builds and signs a real Soroban `transfer` auth entry.
///
/// The flow mirrors the canonical `@x402/stellar` client (and this repo's
/// TypeScript/Python SDKs): build an `InvokeHostFunction` transfer from the
/// NULL account, simulate, sign the payer's ADDRESS-credential auth entry
/// with ed25519 over the `SorobanAuthorization` preimage hash, splice the
/// signed auth + simulated resource fee back in, and re-simulate (the
/// signature adds bytes, so the pre-signature resource fee is too low).
pub struct EnvSigner {
    secret: String,
    signing_key: SigningKey,
    public_key: [u8; 32],
    address: String,
    rpc: RpcClient,
}

impl EnvSigner {
    /// Reads `STELLAR_SECRET_KEY` (and optionally `STELLAR_RPC_URL`) from the
    /// environment.
    pub fn from_env() -> Result<Self> {
        let secret = std::env::var("STELLAR_SECRET_KEY")
            .map_err(|_| X402Error::Secret("STELLAR_SECRET_KEY not set".into()))?;
        if secret.is_empty() {
            return Err(X402Error::Secret("STELLAR_SECRET_KEY is empty".into()));
        }
        let rpc_url = std::env::var("STELLAR_RPC_URL")
            .ok()
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| STELLAR_TESTNET_RPC_URL.to_string());
        Self::new(secret, &rpc_url)
    }

    /// Builds a signer from a Stellar secret seed (`S…`), validated through
    /// `stellar-strkey`.
    pub fn new(secret: String, rpc_url: &str) -> Result<Self> {
        if secret.is_empty() {
            return Err(X402Error::Secret("secret is empty".into()));
        }
        let seed = PrivateKey::from_str(secret.trim())
            .map_err(|e| X402Error::Secret(format!("invalid Stellar secret key: {e}")))?;
        let signing_key = SigningKey::from_bytes(&seed.0);
        let public_key = signing_key.verifying_key().to_bytes();
        let address = PublicKey(public_key).to_string().to_string();
        let rpc = RpcClient::new(rpc_url)
            .map_err(|e| X402Error::Sign(format!("connect soroban rpc: {e}")))?;
        Ok(Self {
            secret,
            signing_key,
            public_key,
            address,
            rpc,
        })
    }

    /// The G-account this signer controls.
    pub fn address(&self) -> &str {
        &self.address
    }
}

impl Drop for EnvSigner {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.secret.zeroize();
    }
}

impl std::fmt::Debug for EnvSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnvSigner")
            .field("address", &self.address)
            .field("secret", &"***")
            .finish()
    }
}

fn network_id(passphrase: &str) -> [u8; 32] {
    Sha256::digest(passphrase.as_bytes()).into()
}

fn sc_address(s: &str) -> std::result::Result<ScAddress, X402Error> {
    if let Some(rest) = s.strip_prefix('C') {
        let _ = rest;
        let c = stellar_strkey::Contract::from_str(s)
            .map_err(|e| X402Error::Sign(format!("invalid contract address {s}: {e}")))?;
        Ok(ScAddress::Contract(ContractId(Hash(c.0))))
    } else {
        let pk = stellar_strkey::ed25519::PublicKey::from_str(s)
            .map_err(|e| X402Error::Sign(format!("invalid account address {s}: {e}")))?;
        Ok(ScAddress::Account(AccountId(
            XdrPublicKey::PublicKeyTypeEd25519(Uint256(pk.0)),
        )))
    }
}

fn sc_val_address(s: &str) -> std::result::Result<ScVal, X402Error> {
    Ok(ScVal::Address(sc_address(s)?))
}

fn sc_val_i128(v: i128) -> ScVal {
    ScVal::I128(Int128Parts {
        hi: (v >> 64) as i64,
        lo: v as u64,
    })
}

/// Builds an unsigned V1 envelope invoking `transfer(from, to, amount)` on the
/// token contract, sourced from the NULL account.
fn build_transfer_envelope(
    asset: &str,
    from: &str,
    to: &str,
    amount: i128,
    timeout_seconds: u64,
    now_unix: u64,
) -> Result<TransactionEnvelope> {
    let host_function = HostFunction::InvokeContract(InvokeContractArgs {
        contract_address: sc_address(asset)?,
        function_name: ScSymbol(
            "transfer"
                .try_into()
                .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
        ),
        args: VecM::try_from(vec![
            sc_val_address(from)?,
            sc_val_address(to)?,
            sc_val_i128(amount),
        ])
        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
    });
    let operation = Operation {
        source_account: None,
        body: OperationBody::InvokeHostFunction(InvokeHostFunctionOp {
            host_function,
            auth: VecM::default(),
        }),
    };
    let null_pk = stellar_strkey::ed25519::PublicKey::from_str(NULL_ACCOUNT)
        .map_err(|e| X402Error::Sign(e.to_string()))?;
    let tx = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(null_pk.0)),
        fee: BASE_FEE_STROOPS,
        seq_num: SequenceNumber(0),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(now_unix.saturating_add(timeout_seconds)),
        }),
        memo: Memo::None,
        operations: VecM::try_from(vec![operation])
            .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
        ext: TransactionExt::V0,
    };
    Ok(TransactionEnvelope::Tx(TransactionV1Envelope {
        tx,
        signatures: VecM::default(),
    }))
}

/// SHA-256 of the `HashIdPreimage::SorobanAuthorization` — the payload Stellar
/// ed25519 account credentials sign for an auth entry.
fn auth_preimage_hash(
    passphrase: &str,
    nonce: i64,
    signature_expiration_ledger: u32,
    invocation: &SorobanAuthorizedInvocation,
) -> Result<[u8; 32]> {
    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: Hash(network_id(passphrase)),
        nonce,
        signature_expiration_ledger,
        invocation: invocation.clone(),
    });
    let bytes = preimage
        .to_xdr(Limits::none())
        .map_err(|e| X402Error::Sign(e.to_string()))?;
    Ok(Sha256::digest(bytes).into())
}

/// The `__check_auth` signature payload: `[{public_key, signature}]` as ScVal.
fn ed25519_signature_val(public_key: &[u8; 32], signature: &[u8; 64]) -> Result<ScVal> {
    let entry = ScVal::Map(Some(ScMap(
        VecM::try_from(vec![
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(
                    "public_key"
                        .try_into()
                        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
                )),
                val: ScVal::Bytes(ScBytes(
                    public_key
                        .to_vec()
                        .try_into()
                        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
                )),
            },
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(
                    "signature"
                        .try_into()
                        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
                )),
                val: ScVal::Bytes(ScBytes(
                    signature
                        .to_vec()
                        .try_into()
                        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
                )),
            },
        ])
        .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
    )));
    Ok(ScVal::Vec(Some(ScVec(
        VecM::try_from(vec![entry]).map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?,
    ))))
}

#[async_trait]
impl StellarSigner for EnvSigner {
    async fn sign_exact(&self, accepted: &crate::Requirement) -> Result<String> {
        // The exact scheme requires the facilitator to sponsor fees: the
        // client never spends a sequence number or pays the fee.
        let sponsored = accepted
            .extra
            .as_ref()
            .and_then(|e| e.get("areFeesSponsored"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !sponsored {
            return Err(X402Error::Sign(
                "Exact scheme requires areFeesSponsored to be true".into(),
            ));
        }
        let amount: i128 = accepted
            .amount
            .parse()
            .map_err(|_| X402Error::Sign(format!("invalid amount: {}", accepted.amount)))?;
        if amount <= 0 {
            return Err(X402Error::Sign(format!(
                "Invalid amount: {amount}. Amount must be a positive integer."
            )));
        }
        let timeout = accepted.max_timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS);

        let latest = self
            .rpc
            .get_latest_ledger()
            .await
            .map_err(|e| X402Error::Sign(format!("get latest ledger: {e}")))?;
        let expiration = latest
            .sequence
            .saturating_add((timeout / ESTIMATED_LEDGER_SECONDS) as u32);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let mut envelope = build_transfer_envelope(
            &accepted.asset,
            &self.address,
            &accepted.pay_to,
            amount,
            timeout,
            now,
        )?;

        // Simulate #1: obtain the auth entries the token contract requires.
        let sim = self
            .rpc
            .simulate_transaction_envelope(&envelope, None)
            .await
            .map_err(|e| X402Error::Sign(format!("simulate: {e}")))?;
        if let Some(err) = &sim.error {
            return Err(X402Error::Sign(format!("simulation failed: {err}")));
        }
        if sim.restore_preamble.is_some() {
            return Err(X402Error::Sign(
                "simulation requires a footprint restore; retry later".into(),
            ));
        }
        let results = sim
            .results()
            .map_err(|e| X402Error::Sign(format!("simulation results: {e}")))?;
        let mut auth = results.first().map(|r| r.auth.clone()).unwrap_or_default();

        // Sign the payer's ADDRESS-credential entries with ed25519.
        let mut signed = 0usize;
        for entry in auth.iter_mut() {
            let SorobanCredentials::Address(creds) = &mut entry.credentials else {
                continue;
            };
            let ScAddress::Account(AccountId(XdrPublicKey::PublicKeyTypeEd25519(Uint256(pk)))) =
                &creds.address
            else {
                continue;
            };
            if *pk != self.public_key {
                continue;
            }
            creds.signature_expiration_ledger = expiration;
            let hash = auth_preimage_hash(
                TESTNET_PASSPHRASE,
                creds.nonce,
                creds.signature_expiration_ledger,
                &entry.root_invocation,
            )?;
            let signature = self.signing_key.sign(&hash).to_bytes();
            creds.signature = ed25519_signature_val(&self.public_key, &signature)?;
            signed += 1;
        }
        if signed != 1 {
            return Err(X402Error::Sign(format!(
                "expected exactly one auth entry for {}, signed {signed}",
                self.address
            )));
        }

        // Splice the signed auth, simulated resource fee and soroban data in.
        {
            let TransactionEnvelope::Tx(inner) = &mut envelope else {
                return Err(X402Error::Sign("not a Tx envelope".into()));
            };
            let op = inner
                .tx
                .operations
                .iter_mut()
                .next()
                .ok_or_else(|| X402Error::Sign("missing operation".into()))?;
            let OperationBody::InvokeHostFunction(ihf) = &mut op.body else {
                return Err(X402Error::Sign("not an InvokeHostFunction operation".into()));
            };
            ihf.auth = auth
                .try_into()
                .map_err(|e: stellar_xdr::Error| X402Error::Sign(e.to_string()))?;
            if let Ok(data) = sim.transaction_data() {
                let resource_fee = u64::try_from(data.resource_fee.max(0)).unwrap_or(0);
                inner.tx.fee = u32::try_from(
                    u64::from(BASE_FEE_STROOPS).saturating_add(resource_fee),
                )
                .unwrap_or(u32::MAX);
                inner.tx.ext = TransactionExt::V1(data);
            }
        }

        // Simulate #2: the signature adds bytes, so the resource fee computed
        // before signing is too low. The canonical client re-simulates too.
        let confirm = self
            .rpc
            .simulate_transaction_envelope(&envelope, None)
            .await
            .map_err(|e| X402Error::Sign(format!("re-simulate: {e}")))?;
        if let Some(err) = &confirm.error {
            return Err(X402Error::Sign(format!(
                "simulation failed after signing auth entries: {err}"
            )));
        }

        envelope
            .to_xdr_base64(Limits::none())
            .map_err(|e| X402Error::Sign(e.to_string()))
    }
}
