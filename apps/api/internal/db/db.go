// Package db owns the Postgres connection pool and the schema migrations.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed migrations/*.sql
var migrations embed.FS

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	// Spans for every query. Without a tracer provider they are no-ops.
	cfg.ConnConfig.Tracer = otelpgx.NewTracer()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// Migrate applies every pending migration embedded in the binary. It holds a
// Postgres advisory lock while it works, so several instances starting at once
// (MIGRATE_ON_START) or a release step overlapping a deploy cannot apply the
// same migration twice: one migrates, the others wait and then find nothing to do.
func Migrate(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger) error {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}

	// Closing the wrapper does not close the pool it borrows connections from.
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() {
		if err := sqlDB.Close(); err != nil {
			logger.WarnContext(ctx, "close migration connection", "error", err)
		}
	}()

	// Poll every second for up to five minutes. Goose's default polls every
	// five seconds, which makes each waiting instance start that much later.
	locker, err := lock.NewPostgresSessionLocker(lock.WithLockTimeout(1, 300))
	if err != nil {
		return fmt.Errorf("create migration lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, files, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}

	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	for _, r := range results {
		logger.InfoContext(ctx, "applied migration", "file", r.Source.Path, "duration_ms", r.Duration.Milliseconds())
	}
	if len(results) == 0 {
		logger.InfoContext(ctx, "no pending migrations")
	}
	return nil
}
