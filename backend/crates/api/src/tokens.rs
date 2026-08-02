//! Token primitives: opaque token generation, SHA-256 hashing-at-rest,
//! and JWT access-token encode/decode.
//!
//! Hygiene rules enforced here:
//! - Opaque tokens (refresh/verify/reset) are returned to the caller exactly
//!   once; only their SHA-256 hash is ever persisted (Postgres).
//! - JWT access tokens are signed and short-lived; never stored.
//! - No token value is ever logged.

use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Validation, decode, encode};
use rand::distributions::Alphanumeric;
use rand::{Rng, thread_rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use shared::Error;
use uuid::Uuid;

/// 32 bytes of URL-safe-ish entropy → opaque bearer token.
pub fn generate_opaque_token() -> String {
    let bytes: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    bytes
}

/// SHA-256 of a raw token, lowercase hex. This (and only this) is persisted.
pub fn hash_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

/// Random single-use token for email verification / password reset / OAuth
/// CSRF state. Same entropy as [`generate_opaque_token`].
pub fn generate_use_token() -> String {
    generate_opaque_token()
}

// ---- JWT access tokens ---------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject = user id.
    pub sub: Uuid,
    pub iat: i64,
    pub exp: i64,
}

impl Claims {
    pub fn new(user_id: Uuid, ttl_seconds: i64) -> Self {
        let now = Utc::now();
        Self {
            sub: user_id,
            iat: now.timestamp(),
            exp: (now + Duration::seconds(ttl_seconds)).timestamp(),
        }
    }
}

#[derive(Clone)]
pub struct JwtIssuer {
    secret: String,
    access_ttl: i64,
}

impl JwtIssuer {
    pub fn new(secret: String, access_ttl: i64) -> Self {
        Self { secret, access_ttl }
    }

    pub fn secret(&self) -> &str {
        &self.secret
    }

    pub fn encode(&self, user_id: Uuid) -> std::result::Result<String, Error> {
        encode(
            &jsonwebtoken::Header::default(),
            &Claims::new(user_id, self.access_ttl),
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| {
            tracing::error!(error = %e, "jwt encode failed");
            Error::internal(e)
        })
    }

    pub fn decode(&self, token: &str) -> std::result::Result<Claims, Error> {
        let mut validation = Validation::default();
        validation.validate_exp = true;
        validation.leeway = 0;
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map(|d| d.claims)
        .map_err(|_| Error::Unauthorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_token_is_long_and_unpredictable() {
        let a = generate_opaque_token();
        let b = generate_opaque_token();
        assert!(a.len() >= 40);
        assert_ne!(a, b);
        assert!(a.chars().all(char::is_alphanumeric));
    }

    #[test]
    fn hash_is_stable_sha256_hex() {
        assert_eq!(
            hash_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_ne!(hash_token("abc"), hash_token("abd"));
        assert_eq!(hash_token("abc").len(), 64);
    }

    #[test]
    fn jwt_round_trip() {
        let issuer = JwtIssuer::new("test-secret".into(), 900);
        let id = Uuid::new_v4();
        let token = issuer.encode(id).expect("encodes");
        let claims = issuer.decode(&token).expect("decodes");
        assert_eq!(claims.sub, id);
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn jwt_rejects_expired_tokens() {
        let issuer = JwtIssuer::new("test-secret".into(), -10);
        let token = issuer.encode(Uuid::new_v4()).expect("encodes");
        assert!(matches!(issuer.decode(&token), Err(Error::Unauthorized)));
    }

    #[test]
    fn jwt_rejects_tampered_or_wrong_secret() {
        let a = JwtIssuer::new("secret-a".into(), 900);
        let b = JwtIssuer::new("secret-b".into(), 900);
        let token = a.encode(Uuid::new_v4()).expect("encodes");
        assert!(matches!(b.decode(&token), Err(Error::Unauthorized)));
        // Tampered token.
        let mut chars: Vec<char> = token.chars().collect();
        let last = chars.len() - 1;
        chars[last] = if chars[last] == 'a' { 'b' } else { 'a' };
        assert!(matches!(
            a.decode(&chars.iter().collect::<String>()),
            Err(Error::Unauthorized)
        ));
    }
}
