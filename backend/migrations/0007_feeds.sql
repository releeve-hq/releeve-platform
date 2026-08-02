-- Network feeds (doc 03 §6.1): token volume rollup + USD price cache.

CREATE TABLE token_volume_stats (
  network          TEXT NOT NULL,
  asset            TEXT NOT NULL,
  window_start     TIMESTAMPTZ NOT NULL,
  window_seconds   INTEGER NOT NULL,
  volume           NUMERIC NOT NULL DEFAULT 0,
  usd_volume       NUMERIC,
  tx_count         BIGINT NOT NULL DEFAULT 0,
  active_accounts  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (network, asset, window_start, window_seconds)
);

CREATE TABLE token_prices (
  network      TEXT NOT NULL,
  asset        TEXT NOT NULL,
  price_usd    NUMERIC NOT NULL,
  source       TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, asset)
);
