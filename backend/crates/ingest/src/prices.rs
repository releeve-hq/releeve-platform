//! Concrete [`PriceFeed`] adapter over an external HTTP price source.
//!
//! Releeve owns the cache, never the source: this adapter fetches USD quotes
//! for a set of assets, persists them to `token_prices` via [`apply_quotes`],
//! and degrades gracefully — a missing/stale/upstream-failing quote is simply
//! not returned (the rollup then yields `NULL` USD), never a hard error.

use serde_json::Value;

use crate::rollup::{PriceFeed, Quote, apply_quotes, price_error::PriceError};

/// A swappable HTTP price source. Thin on purpose: parse the provider's
/// `{ "prices": { "XLM": "0.12", "USDC:GX": "1.0" } }` shape, persist, done.
pub struct HttpPriceFeed {
    http: reqwest::Client,
    base_url: String,
}

impl HttpPriceFeed {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
        }
    }
}

/// Parse the provider payload into quotes. Entries that are absent, malformed,
/// or non-numeric are skipped — the caller then just has fewer quotes and the
/// rollup shows `NULL` USD for them (never a failed request).
pub fn parse_prices(payload: &Value) -> Vec<Quote> {
    let Some(prices) = payload.get("prices").and_then(Value::as_object) else {
        return Vec::new();
    };
    prices
        .iter()
        .filter_map(|(asset, price)| {
            let s = match price {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => return None,
            };
            // A quote is only usable if it parses as a decimal number.
            if s.trim().is_empty() || s.parse::<f64>().is_err() {
                return None;
            }
            Some(Quote {
                asset: asset.clone(),
                price_usd: s,
            })
        })
        .collect()
}

#[async_trait::async_trait]
impl PriceFeed for HttpPriceFeed {
    async fn refresh(
        &self,
        pool: &sqlx::PgPool,
        network: &str,
        assets: &[&str],
    ) -> Result<Vec<Quote>, PriceError> {
        let joined = assets.join(",");
        let url = format!("{}/prices?assets={}", self.base_url, joined);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|_| PriceError::Upstream("request failed"))?;
        if !resp.status().is_success() {
            return Err(PriceError::Upstream("non-2xx response"));
        }
        let payload: Value = resp
            .json()
            .await
            .map_err(|_| PriceError::Upstream("unparseable body"))?;

        let quotes = parse_prices(&payload);
        let mut conn = pool.acquire().await?;
        apply_quotes(&mut conn, network, &quotes).await?;
        Ok(quotes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_string_and_numeric_prices() {
        let v = json!({
            "prices": {
                "XLM": "0.12",
                "USDC:GX": 1.0,
                "BAD": null,
                "EMPTY": "",
                "NAN": "abc"
            }
        });
        let quotes = parse_prices(&v);
        let mut map: Vec<(String, String)> = quotes
            .iter()
            .map(|q| (q.asset.clone(), q.price_usd.clone()))
            .collect();
        map.sort();
        assert_eq!(
            map,
            vec![
                ("USDC:GX".into(), "1.0".into()),
                ("XLM".into(), "0.12".into())
            ]
        );
    }

    #[test]
    fn missing_prices_key_yields_no_quotes() {
        assert!(parse_prices(&json!({})).is_empty());
        assert!(parse_prices(&json!({ "prices": [] })).is_empty());
    }
}
