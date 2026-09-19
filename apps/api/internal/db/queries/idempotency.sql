-- name: ClaimIdempotencyKey :execrows
-- Zero rows means the key already exists. A concurrent request holding the
-- same key blocks here until it commits or rolls back.
INSERT INTO idempotency_keys (user_id, key, operation, request_hash)
VALUES (@user_id, @key, @operation, @request_hash)
ON CONFLICT (user_id, key) DO NOTHING;

-- name: GetIdempotencyKey :one
SELECT operation, request_hash, response FROM idempotency_keys
WHERE user_id = @user_id AND key = @key;

-- name: SaveIdempotentResponse :exec
UPDATE idempotency_keys SET response = @response
WHERE user_id = @user_id AND key = @key;

-- name: DeleteIdempotencyKeysBefore :execrows
DELETE FROM idempotency_keys WHERE created_at < @before;
