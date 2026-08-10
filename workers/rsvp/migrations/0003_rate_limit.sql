-- Additive table (not in the original 4-table spec) backing the 10-requests
-- per-IP-per-10-minutes lookup rate limit. ip_hash is HMAC-SHA256(ip, salt),
-- never the raw IP.
CREATE TABLE rate_limit_lookup (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
