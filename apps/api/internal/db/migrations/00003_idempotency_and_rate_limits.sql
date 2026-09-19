-- +goose Up
-- A client that retries a POST with the same Idempotency-Key gets the first
-- response back instead of a second row. The key is claimed in the same
-- transaction that does the work, so a failed request leaves nothing behind.
CREATE TABLE idempotency_keys (
    user_id text NOT NULL,
    key text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
    operation text NOT NULL,
    -- SHA-256 of the request: the same key with another body is a client bug.
    request_hash bytea NOT NULL,
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- Shared rate-limit windows, used when RATE_LIMIT_STORE=postgres so several API
-- instances enforce one limit. UNLOGGED: losing the counters in a crash only
-- resets the windows, and skipping the WAL keeps the per-request write cheap.
-- id hashes the caller and the window, so no address or user ID is stored.
CREATE UNLOGGED TABLE rate_limit_counters (
    id bigint PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count integer NOT NULL
);

CREATE INDEX rate_limit_counters_window_start_idx ON rate_limit_counters (window_start);

-- +goose Down
DROP TABLE rate_limit_counters;
DROP TABLE idempotency_keys;
