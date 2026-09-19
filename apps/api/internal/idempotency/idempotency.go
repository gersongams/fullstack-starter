// Package idempotency makes a retried POST safe: a request that carries an
// Idempotency-Key runs once, and every retry with the same key gets the first
// response back.
//
// The key is claimed inside the transaction that does the work. A request that
// fails rolls its claim back, so only successes are remembered and a retry
// after an error runs again. Two concurrent requests with the same key
// serialise on the claim: the second waits for the first to finish, then
// replays its response.
package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db/dbgen"
)

// Retention is how long a key is remembered. Retries arrive within seconds or
// minutes; a day is generous and keeps the table small.
const Retention = 24 * time.Hour

// ErrKeyReused means the key was already used for a different request, which
// is a bug in the caller: a key identifies one request, not one client.
var ErrKeyReused = errors.New("idempotency key was already used for a different request")

// Key is the caller's Idempotency-Key and a fingerprint of the request it
// came with.
type Key struct {
	Value       string
	RequestHash []byte
}

// NewKey fingerprints request, which must marshal deterministically (a struct,
// not a map). It returns nil for an empty value: the header is optional.
func NewKey(value string, request any) (*Key, error) {
	if value == "" {
		return nil, nil
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("fingerprint request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return &Key{Value: value, RequestHash: sum[:]}, nil
}

// Do runs fn at most once for (userID, key) and stores its result. On a retry
// it returns the stored result with replayed set, without calling fn. queries
// must be bound to the transaction that fn writes in. A nil key just runs fn.
func Do[T any](ctx context.Context, queries *dbgen.Queries, userID, operation string, key *Key, fn func() (T, error)) (result T, replayed bool, err error) {
	if key == nil {
		result, err = fn()
		return result, false, err
	}

	claimed, err := queries.ClaimIdempotencyKey(ctx, dbgen.ClaimIdempotencyKeyParams{
		UserID:      userID,
		Key:         key.Value,
		Operation:   operation,
		RequestHash: key.RequestHash,
	})
	if err != nil {
		return result, false, fmt.Errorf("claim idempotency key: %w", err)
	}

	if claimed == 0 {
		stored, err := queries.GetIdempotencyKey(ctx, dbgen.GetIdempotencyKeyParams{UserID: userID, Key: key.Value})
		if err != nil {
			return result, false, fmt.Errorf("read idempotency key: %w", err)
		}
		if stored.Operation != operation || !bytes.Equal(stored.RequestHash, key.RequestHash) {
			return result, false, ErrKeyReused
		}
		if err := json.Unmarshal(stored.Response, &result); err != nil {
			return result, false, fmt.Errorf("decode stored response: %w", err)
		}
		return result, true, nil
	}

	result, err = fn()
	if err != nil {
		return result, false, err
	}
	response, err := json.Marshal(result)
	if err != nil {
		return result, false, fmt.Errorf("encode response: %w", err)
	}
	if err := queries.SaveIdempotentResponse(ctx, dbgen.SaveIdempotentResponseParams{
		UserID: userID, Key: key.Value, Response: response,
	}); err != nil {
		return result, false, fmt.Errorf("store idempotent response: %w", err)
	}
	return result, false, nil
}
