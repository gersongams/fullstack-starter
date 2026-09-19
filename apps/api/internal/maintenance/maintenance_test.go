package maintenance_test

import (
	"log/slog"
	"testing"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db/dbgen"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
	"github.com/gersongams/fullstack-starter/apps/api/internal/maintenance"
)

func TestPurgeDeletesOnlyExpiredRows(t *testing.T) {
	pool := dbtest.New(t)
	ctx := t.Context()
	now := time.Now()

	for key, age := range map[string]time.Duration{"fresh": time.Hour, "expired": 25 * time.Hour} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO idempotency_keys (user_id, key, operation, request_hash, created_at) VALUES ('alice', $1, 'create-client', '\x00', $2)`,
			key, now.Add(-age)); err != nil {
			t.Fatal(err)
		}
	}
	for id, age := range map[int64]time.Duration{1: time.Minute, 2: time.Hour} {
		if _, err := pool.Exec(ctx, `INSERT INTO rate_limit_counters (id, window_start, count) VALUES ($1, $2, 1)`, id, now.Add(-age)); err != nil {
			t.Fatal(err)
		}
	}

	maintenance.Purge(ctx, dbgen.New(pool), slog.New(slog.DiscardHandler), now)

	var keys []string
	rows, err := pool.Query(ctx, `SELECT key FROM idempotency_keys`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key)
	}
	if len(keys) != 1 || keys[0] != "fresh" {
		t.Errorf("idempotency keys left = %v, want [fresh]", keys)
	}

	var counters int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM rate_limit_counters`).Scan(&counters); err != nil {
		t.Fatal(err)
	}
	if counters != 1 {
		t.Errorf("rate limit counters left = %d, want 1", counters)
	}
}
