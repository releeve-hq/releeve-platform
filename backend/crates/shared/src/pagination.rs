use serde::Serialize;

pub const DEFAULT_LIMIT: i64 = 10;
pub const ALLOWED_LIMITS: [i64; 4] = [10, 20, 50, 100];

/// Clamp a requested page size to the allowed set {10, 20, 50, 100} (default 10).
/// Values outside the set clamp to the *nearest* allowed size: `21 → 20`,
/// `1000 → 100`, `0`/negatives → `20`.
pub fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        None => DEFAULT_LIMIT,
        Some(l) => ALLOWED_LIMITS
            .iter()
            .min_by_key(|allowed| (*allowed - l).abs())
            .copied()
            .unwrap_or(DEFAULT_LIMIT),
    }
}

/// Pagination metadata attached to every list response.
#[derive(Debug, Clone, Serialize)]
pub struct Pagination {
    pub limit: i64,
    pub next_cursor: Option<String>,
    pub prev_cursor: Option<String>,
}

/// The shared list-response envelope: `{ data, pagination }`.
#[derive(Debug, Clone, Serialize)]
pub struct Paged<T> {
    pub data: Vec<T>,
    pub pagination: Pagination,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_limits_pass_through() {
        for l in [10, 20, 50, 100] {
            assert_eq!(clamp_limit(Some(l)), l);
        }
    }

    #[test]
    fn absent_limit_defaults_to_10() {
        assert_eq!(clamp_limit(None), 10);
    }

    #[test]
    fn clamps_to_nearest_allowed() {
        assert_eq!(clamp_limit(Some(0)), 10);
        assert_eq!(clamp_limit(Some(-5)), 10);
        assert_eq!(clamp_limit(Some(9)), 10);
        assert_eq!(clamp_limit(Some(21)), 20);
        assert_eq!(clamp_limit(Some(49)), 50);
        assert_eq!(clamp_limit(Some(51)), 50);
        assert_eq!(clamp_limit(Some(1000)), 100);
        assert_eq!(clamp_limit(Some(101)), 100);
    }

    #[test]
    fn paged_envelope_serializes() {
        let paged = Paged {
            data: vec![1, 2, 3],
            pagination: Pagination {
                limit: 20,
                next_cursor: Some("abc".into()),
                prev_cursor: None,
            },
        };
        let json = serde_json::to_value(&paged).unwrap();
        assert_eq!(json["data"].as_array().unwrap().len(), 3);
        assert_eq!(json["pagination"]["limit"], 20);
        assert_eq!(json["pagination"]["next_cursor"], "abc");
        assert!(json["pagination"]["prev_cursor"].is_null());
    }
}
