-- name: IncrementRateLimitCounter :exec
INSERT INTO rate_limit_counters (id, window_start, count)
VALUES (@id, @window_start, @amount)
ON CONFLICT (id) DO UPDATE SET count = rate_limit_counters.count + EXCLUDED.count;

-- name: GetRateLimitCounters :many
SELECT id, count FROM rate_limit_counters WHERE id = ANY(@ids::bigint[]);

-- name: DeleteRateLimitCountersBefore :execrows
DELETE FROM rate_limit_counters WHERE window_start < @before;
