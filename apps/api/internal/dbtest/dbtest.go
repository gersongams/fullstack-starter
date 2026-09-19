// Package dbtest gives each test its own migrated Postgres database.
package dbtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db"
)

// defaultURL is the Postgres started by `make db-up`; the same throwaway
// credentials are in compose.yaml and .env.example.
//
//nolint:gosec // G101: local development database, not a secret.
const defaultURL = "postgres://starter:starter@localhost:54320/starter?sslmode=disable"

// New creates a database with every migration applied and drops it when the
// test ends. It fails the test when Postgres is unreachable: a skipped
// database test would let CI pass without running it.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := NewEmpty(t)
	if err := db.Migrate(context.Background(), pool, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return pool
}

// NewEmpty is New without the migrations, for tests of the migrations themselves.
func NewEmpty(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	adminURL := os.Getenv("TEST_DATABASE_URL")
	if adminURL == "" {
		adminURL = defaultURL
	}

	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect to Postgres (run `make db-up` or set TEST_DATABASE_URL): %v", err)
	}

	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	name := "test_" + hex.EncodeToString(suffix)
	quoted := pgx.Identifier{name}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		// WITH (FORCE) ends any connection a failed test left open.
		if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop test database %s: %v", name, err)
		}
		if err := admin.Close(ctx); err != nil {
			t.Errorf("close admin connection: %v", err)
		}
	})

	testURL, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("parse database url: %v", err)
	}
	testURL.Path = "/" + name

	pool, err := db.Connect(ctx, testURL.String())
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	// Registered after the drop, so it runs first: cleanups are last in, first out.
	t.Cleanup(pool.Close)
	return pool
}
