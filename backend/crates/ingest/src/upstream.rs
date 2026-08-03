//! Upstream politeness: exponential backoff with jitter, per-endpoint retry,
//! and a per-network circuit breaker so a dead Horizon/RPC endpoint pauses that
//! network's ingestion without blocking others.
//!
//! Classification contract:
//! - `Reachable::Retryable` → transient (5xx, timeout, network, 429); retried
//!   with backoff and trips the circuit after repeated failure.
//! - `Reachable::NonRetryable` → permanent (other 4xx); returned immediately,
//!   never trips the circuit (it is not a liveness signal).

use std::future::Future;
use std::time::{Duration, Instant};

use rand::Rng;

/// What a single attempt resolved to, carrying its success payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reachable<T = ()> {
    /// Succeeded with the decoded payload.
    Success(T),
    /// Transient upstream failure — retry with backoff.
    Retryable,
    /// Permanent failure (4xx) — do not retry, do not trip the circuit.
    NonRetryable,
}

/// Final outcome of running an operation through the polity layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchError {
    /// Circuit open and not yet ready to probe — fail fast, never touch upstream.
    CircuitOpen,
    /// Retried `max_attempts` times and still transient.
    Exhausted,
    /// Permanent (4xx) failure.
    NonRetryable,
}

/// Exponential backoff: `base * 2^attempt` capped at `max`, with optional
/// jitter applied as a multiplicative factor in `[1 - jitter, 1 + jitter]`.
#[derive(Debug, Clone, Copy)]
pub struct Backoff {
    pub base: Duration,
    pub max: Duration,
    /// Jitter magnitude in `[0,1)`. `0` disables jitter (deterministic, testable).
    pub jitter: f64,
    pub max_attempts: u32,
}

impl Backoff {
    /// Delay for the retry after `attempt` failures (0-based first retry).
    pub fn delay(&self, attempt: u32) -> Duration {
        let mult = if attempt >= 31 {
            u32::MAX
        } else {
            1u32 << attempt
        };
        let exp = self.base.saturating_mul(mult).min(self.max);
        if self.jitter <= 0.0 {
            return exp;
        }
        let factor = 1.0 - self.jitter + rand::thread_rng().gen_range(0.0..(2.0 * self.jitter));
        Duration::from_secs_f64(exp.as_secs_f64() * factor)
    }
}

/// How the circuit breaker decides a caller may proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Allow {
    Allow,
    /// Open — fail fast, do not contact the upstream.
    Open,
    /// Was open but the cooldown elapsed; one trial probe is permitted.
    HalfOpenProbe,
}

/// Per-network circuit-breaker state machine.
#[derive(Debug)]
pub struct CircuitBreaker {
    consecutive_failures: u32,
    tripped_at: Option<Instant>,
    max_failures: u32,
    cooldown: Duration,
}

impl CircuitBreaker {
    pub fn new(max_failures: u32, cooldown: Duration) -> Self {
        Self {
            consecutive_failures: 0,
            tripped_at: None,
            max_failures,
            cooldown,
        }
    }

    pub fn is_tripped(&self) -> bool {
        self.tripped_at.is_some()
    }

    /// Whether a request may be sent now. When tripped and the cooldown has
    /// elapsed, arms a single probe (half-open).
    pub fn allow(&mut self, now: Instant) -> Allow {
        match self.tripped_at {
            None => Allow::Allow,
            Some(t) => {
                if now.duration_since(t) >= self.cooldown {
                    self.tripped_at = None;
                    Allow::HalfOpenProbe
                } else {
                    Allow::Open
                }
            }
        }
    }

    /// A request succeeded: reset the failure streak and trip.
    pub fn on_success(&mut self) {
        self.consecutive_failures = 0;
        self.tripped_at = None;
    }

    /// A transient failure occurred. Returns `true` when this failure just
    /// tripped the breaker.
    pub fn on_failure(&mut self, now: Instant) -> bool {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.max_failures && self.tripped_at.is_none() {
            self.tripped_at = Some(now);
            self.consecutive_failures = 0;
            true
        } else {
            false
        }
    }
}

/// Run `attempt` under the polity epoche: circuit gate, then retry with backoff.
pub async fn fetch_with_policy<T, F, Fut>(
    breaker: &mut CircuitBreaker,
    policy: &Backoff,
    mut attempt: F,
) -> Result<T, FetchError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Reachable<T>>,
{
    if let Allow::Open = breaker.allow(Instant::now()) {
        return Err(FetchError::CircuitOpen);
    }

    for i in 0..policy.max_attempts {
        match attempt().await {
            Reachable::Success(value) => {
                breaker.on_success();
                return Ok(value);
            }
            Reachable::NonRetryable => return Err(FetchError::NonRetryable),
            Reachable::Retryable => {
                if breaker.on_failure(Instant::now()) {
                    return Err(FetchError::Exhausted);
                }
                if i + 1 < policy.max_attempts {
                    tokio::time::sleep(policy.delay(i)).await;
                }
            }
        }
    }
    Err(FetchError::Exhausted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn policy() -> Backoff {
        Backoff {
            base: Duration::from_millis(1),
            max: Duration::from_millis(10),
            jitter: 0.0,
            max_attempts: 5,
        }
    }

    #[test]
    fn backoff_grows_exponentially_and_is_capped() {
        let p = Backoff {
            base: Duration::from_millis(10),
            max: Duration::from_millis(100),
            jitter: 0.0,
            max_attempts: 10,
        };
        assert_eq!(p.delay(0), Duration::from_millis(10));
        assert_eq!(p.delay(1), Duration::from_millis(20));
        assert_eq!(p.delay(2), Duration::from_millis(40));
        assert_eq!(p.delay(3), Duration::from_millis(80));
        assert_eq!(p.delay(9), Duration::from_millis(100), "capped at max");
    }

    #[tokio::test]
    async fn transient_then_success_retries_and_recovers() {
        use Reachable::{Retryable, Success};
        let calls = Arc::new(AtomicU32::new(0));
        let mut cb = CircuitBreaker::new(3, Duration::from_millis(1_000));
        let c = calls.clone();
        let res = fetch_with_policy(&mut cb, &policy(), move || {
            let n = c.fetch_add(1, Ordering::SeqCst);
            async move { if n < 2 { Retryable } else { Success(42u32) } }
        })
        .await;
        assert_eq!(res, Ok(42));
        assert_eq!(calls.load(Ordering::SeqCst), 3, "two retries then success");
        assert!(!cb.is_tripped());
    }

    #[tokio::test]
    async fn persistent_failure_opens_circuit_and_open_short_circuits() {
        use Reachable::Retryable;
        let mut cb = CircuitBreaker::new(2, Duration::from_millis(60_000));
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let out: Result<(), FetchError> = fetch_with_policy(&mut cb, &policy(), move || {
            c.fetch_add(1, Ordering::SeqCst);
            async { Retryable::<()> }
        })
        .await;
        assert_eq!(out, Err(FetchError::Exhausted));
        assert!(cb.is_tripped());

        let n = calls.load(Ordering::SeqCst);
        // Circuit open → fail fast without touching the upstream.
        let res: Result<(), FetchError> = fetch_with_policy(&mut cb, &policy(), || async {
            Reachable::<()>::Success(())
        })
        .await;
        assert_eq!(res, Err(FetchError::CircuitOpen));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            n,
            "no extra attempt when open"
        );
    }

    #[tokio::test]
    async fn non_retryable_returns_without_retrying_or_opening() {
        use Reachable::NonRetryable;
        let mut cb = CircuitBreaker::new(2, Duration::from_millis(60_000));
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let res: Result<u32, FetchError> = fetch_with_policy(&mut cb, &policy(), move || {
            c.fetch_add(1, Ordering::SeqCst);
            async { NonRetryable::<u32> }
        })
        .await;
        assert_eq!(res, Err(FetchError::NonRetryable));
        assert_eq!(calls.load(Ordering::SeqCst), 1, "no retry for 4xx");
        assert!(!cb.is_tripped());
    }

    #[test]
    fn success_closes_open_circuit() {
        let mut cb = CircuitBreaker::new(2, Duration::from_millis(1_000));
        cb.on_failure(Instant::now());
        cb.on_failure(Instant::now());
        assert!(cb.is_tripped());

        cb.on_success();
        assert!(!cb.is_tripped());
        assert_eq!(cb.allow(Instant::now()), Allow::Allow);
    }

    #[test]
    fn circuit_reopens_after_cooldown_via_probe() {
        let mut cb = CircuitBreaker::new(2, Duration::from_millis(0));
        cb.on_failure(Instant::now());
        cb.on_failure(Instant::now());
        assert_eq!(cb.allow(Instant::now()), Allow::HalfOpenProbe);
        assert_eq!(cb.allow(Instant::now()), Allow::Allow);
    }
}
