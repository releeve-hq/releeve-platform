//! Asset resolution (classic alphanumeric vs native) and SEP-41 token
//! classification. Used by the classic-transaction decoder and the
//! top-tokens / transfers feeds.
//!
//! An asset on the network is addressed differently depending on its kind:
//! - native classic asset → canonical `XLM`
//! - classic alphanumeric (SEP-11) → canonical `"{CODE}:{ISSUER}"`
//! - SEP-41 Soroban token → the contract id itself (`C...`)

/// Canonical stored identifier for a classic Horizon asset. `type` is one of
/// `native`, `credit_alphanum4`, `credit_alphanum12`.
pub fn classic_asset(asset_type: &str, code: Option<&str>, issuer: Option<&str>) -> String {
    if asset_type == "native" {
        return "XLM".to_string();
    }
    match (code, issuer) {
        (Some(code), Some(issuer)) => format!("{code}:{issuer}"),
        // Malformed classic asset: caller has provided no way to address it.
        _ => "UNKNOWN".to_string(),
    }
}

/// A contract is a SEP-41 token when its Soroban interface exposes the token
/// entry-points. We check the stable core set (`name`, `balance`, `transfer`)
/// so Lumen-style fungibles and NFTs (SEP-41 also covers NFTs) both classify,
/// while non-token contracts (e.g. a pure utility contract) do not.
pub fn is_sep41_interface(functions: &[String]) -> bool {
    let set = |s: &str| functions.iter().any(|f| f == s);
    set("balance") && set("name") && (set("transfer") || set("transfer_from"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_maps_to_xlm() {
        assert_eq!(classic_asset("native", None, None), "XLM");
        assert_eq!(
            classic_asset("native", Some("USDC"), Some("GABC")),
            "XLM",
            "native ignores code/issuer"
        );
    }

    #[test]
    fn alphanumeric_maps_to_code_issuer() {
        assert_eq!(
            classic_asset("credit_alphanum4", Some("USDC"), Some("GABC")),
            "USDC:GABC"
        );
        assert_eq!(
            classic_asset("credit_alphanum12", Some("SOMELONGC"), Some("GDEF")),
            "SOMELONGC:GDEF"
        );
    }

    #[test]
    fn unaddressable_asset_is_flag() {
        assert_eq!(classic_asset("credit_alphanum4", None, None), "UNKNOWN");
        assert_eq!(
            classic_asset("credit_alphanum4", Some("USDC"), None),
            "UNKNOWN"
        );
    }

    #[test]
    fn sep41_interface_classifies_fungibles() {
        let token = [
            "name",
            "symbol",
            "decimals",
            "balance",
            "transfer",
            "transfer_from",
        ]
        .map(String::from)
        .to_vec();
        assert!(is_sep41_interface(&token));
    }

    #[test]
    fn non_token_contract_excluded() {
        let util = ["put", "get", "payout"].map(String::from).to_vec();
        assert!(!is_sep41_interface(&util));
    }

    #[test]
    fn reads_without_transfer_do_not_classify() {
        // `balance` + `name` but no token movement entry point.
        let read_only = ["balance", "name", "owner"].map(String::from).to_vec();
        assert!(!is_sep41_interface(&read_only));
    }
}
