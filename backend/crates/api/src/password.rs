//! Password hashing and verification (argon2id).

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use shared::Error;

/// Argon2id with default OWASP-recommended parameters (the `Argon2` default
/// uses m=19456 KiB, t=2, p=1). Returns a PHC string suitable for storage.
pub fn hash_password(password: &str) -> std::result::Result<String, Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| {
            tracing::error!(error = %e, "password hashing failed");
            Error::internal(std::io::Error::other(e.to_string()))
        })
}

/// Verify a password against a stored PHC hash. A missing/invalid hash or any
/// mismatch yields `Unauthorized` — never leaks *why* it failed.
pub fn verify_password(password: &str, stored_hash: &str) -> std::result::Result<(), Error> {
    let parsed = PasswordHash::new(stored_hash).map_err(|_| Error::Unauthorized)?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| Error::Unauthorized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_round_trip() {
        let hash = hash_password("hunter2-secret").expect("hashes");
        assert_ne!(hash, "hunter2-secret");
        assert!(hash.starts_with("$argon2"), "argon2 PHC format");
        verify_password("hunter2-secret", &hash).expect("matches");
    }

    #[test]
    fn wrong_password_fails_with_unauthorized() {
        let hash = hash_password("right-password").expect("hashes");
        assert!(matches!(
            verify_password("wrong-password", &hash),
            Err(Error::Unauthorized)
        ));
    }

    #[test]
    fn salt_is_unique_per_hash() {
        let a = hash_password("same-password").expect("hashes a");
        let b = hash_password("same-password").expect("hashes b");
        assert_ne!(a, b, "salts differ, hashes differ");
    }

    #[test]
    fn garbage_stored_hash_fails_closed() {
        assert!(matches!(
            verify_password("anything", "not-a-phc-hash"),
            Err(Error::Unauthorized)
        ));
        assert!(matches!(
            verify_password("anything", ""),
            Err(Error::Unauthorized)
        ));
    }
}
