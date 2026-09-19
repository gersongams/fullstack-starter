// Package maintenance deletes rows that have outlived their purpose. It runs
// inside the API process: the work is two cheap indexed deletes, every
// instance may run it safely, and it spares the deployment a job scheduler.
package maintenance

import (
	"context"
	"log/slog"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db/dbgen"
	"github.com/gersongams/fullstack-starter/apps/api/internal/idempotency"
)

const (
	interval = time.Hour
	// Rate-limit windows last a minute and only the current and the previous
	// one are read.
	rateLimitRetention = 10 * time.Minute
	purgeTimeout       = 30 * time.Second
)

// Run purges once, then every hour until ctx is cancelled.
func Run(ctx context.Context, db dbgen.DBTX, logger *slog.Logger) {
	queries := dbgen.New(db)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		Purge(ctx, queries, logger, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Purge deletes what expired before now. A failure is logged and retried on
// the next tick: stale rows cost disk space, not correctness.
func Purge(ctx context.Context, queries *dbgen.Queries, logger *slog.Logger, now time.Time) {
	ctx, cancel := context.WithTimeout(ctx, purgeTimeout)
	defer cancel()

	keys, err := queries.DeleteIdempotencyKeysBefore(ctx, now.Add(-idempotency.Retention))
	if err != nil {
		logger.WarnContext(ctx, "purge idempotency keys", "error", err)
	}
	counters, err := queries.DeleteRateLimitCountersBefore(ctx, now.Add(-rateLimitRetention))
	if err != nil {
		logger.WarnContext(ctx, "purge rate limit counters", "error", err)
	}
	if keys > 0 || counters > 0 {
		logger.InfoContext(ctx, "purged expired rows", "idempotency_keys", keys, "rate_limit_counters", counters)
	}
}
