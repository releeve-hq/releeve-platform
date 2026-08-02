use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// An opaque keyset cursor: `(sort_key, stable_id)` encoded as base64url.
///
/// Keyset pagination is O(log n) per page and stable under concurrent writes
/// (unlike `OFFSET`). The `stable_id` is the row's primary key and breaks
/// ties when two rows share a `sort_key` — the ordering used by list queries
/// must be `(sort_key, stable_id)`, backed by the composite indexes in doc 03 §9.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cursor {
    pub sort_key: String,
    pub stable_id: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CursorError {
    #[error("malformed cursor")]
    Malformed,
}

impl Cursor {
    pub fn new(sort_key: impl Into<String>, stable_id: impl Into<String>) -> Self {
        Self {
            sort_key: sort_key.into(),
            stable_id: stable_id.into(),
        }
    }

    /// Encode to opaque base64url (URL-safe, no padding).
    pub fn encode(&self) -> String {
        let json = serde_json::to_vec(self).expect("cursor always serializes");
        URL_SAFE_NO_PAD.encode(json)
    }

    /// Decode from base64url. Garbage or structurally-invalid input → error,
    /// never a panic.
    pub fn decode(raw: &str) -> Result<Self, CursorError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(raw)
            .map_err(|_| CursorError::Malformed)?;
        let cursor: Cursor = serde_json::from_slice(&bytes).map_err(|_| CursorError::Malformed)?;
        if cursor.sort_key.is_empty() || cursor.stable_id.is_empty() {
            return Err(CursorError::Malformed);
        }
        Ok(cursor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_sort_key_and_id() {
        let c = Cursor::new("3860074", "00000000-0000-4000-8000-000000000001");
        let encoded = c.encode();
        let decoded = Cursor::decode(&encoded).expect("decodes");
        assert_eq!(decoded, c);
    }

    #[test]
    fn round_trip_with_timestamp_sort_key() {
        let c = Cursor::new("2026-08-01T12:00:00Z", "abc-123");
        assert_eq!(Cursor::decode(&c.encode()).unwrap(), c);
    }

    #[test]
    fn encode_is_url_safe_base64url() {
        // Deliberately weird bytes so the base64 would normally contain +, / or =.
        let c = Cursor::new("he\u{FF}llo/\u{7F}", "id\x01\x02");
        let encoded = c.encode();
        assert!(!encoded.contains('+'), "url-safe: no '+'");
        assert!(!encoded.contains('/'), "url-safe: no '/'");
        assert!(!encoded.contains('='), "url-safe: no padding '='");
        assert!(!encoded.contains('\n'));
    }

    #[test]
    fn garbage_input_errors_not_panics() {
        assert_eq!(
            Cursor::decode("!!!not base64url!!!"),
            Err(CursorError::Malformed)
        );
        assert_eq!(
            Cursor::decode("aGVsbG8"),
            Err(CursorError::Malformed),
            "valid b64 but not valid JSON"
        );
        assert_eq!(Cursor::decode(""), Err(CursorError::Malformed));
        assert_eq!(
            Cursor::decode("eyJzb3J0X2tleSI6IiIsInN0YWJsZV9pZCI6IiJ9"),
            Err(CursorError::Malformed),
            "empty fields rejected"
        );
    }

    #[test]
    fn forward_and_backward_cursors_are_distinct() {
        let a = Cursor::new("100", "id-a");
        let b = Cursor::new("99", "id-b");
        assert_ne!(a.encode(), b.encode());
    }
}
