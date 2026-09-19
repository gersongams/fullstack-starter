package httpapi

import (
	"context"
	"log/slog"
	"time"

	"github.com/go-chi/httprate"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db/dbgen"
)

// counterTimeout bounds the database work the limiter adds to a request.
const counterTimeout = 250 * time.Millisecond

// postgresCounter keeps the rate-limit windows in Postgres, so several API
// instances enforce one limit instead of one each.
//
// It fails open. A limiter that cannot reach its store must not take the API
// down with it: errors are logged and the request is let through. httprate's
// interface carries no context, hence the background context and the timeout.
type postgresCounter struct {
	queries *dbgen.Queries
	logger  *slog.Logger
	window  time.Duration
}

// NewPostgresLimitCounter returns a shared counter for Deps.RateLimitCounter.
func NewPostgresLimitCounter(db dbgen.DBTX, logger *slog.Logger) httprate.LimitCounter {
	return &postgresCounter{queries: dbgen.New(db), logger: logger}
}

func (c *postgresCounter) Config(_ int, windowLength time.Duration) {
	c.window = windowLength
}

func (c *postgresCounter) Increment(key string, currentWindow time.Time) error {
	return c.IncrementBy(key, currentWindow, 1)
}

func (c *postgresCounter) IncrementBy(key string, currentWindow time.Time, amount int) error {
	ctx, cancel := context.WithTimeout(context.Background(), counterTimeout)
	defer cancel()

	err := c.queries.IncrementRateLimitCounter(ctx, dbgen.IncrementRateLimitCounterParams{
		ID:          counterID(key, currentWindow),
		WindowStart: currentWindow,
		Amount:      int32(amount), //nolint:gosec // httprate increments by 1 or a small configured cost.
	})
	if err != nil {
		c.logger.WarnContext(ctx, "rate limit counter unavailable, letting the request through", "error", err)
	}
	return nil
}

func (c *postgresCounter) Get(key string, currentWindow, previousWindow time.Time) (current, previous int, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), counterTimeout)
	defer cancel()

	currentID, previousID := counterID(key, currentWindow), counterID(key, previousWindow)
	rows, err := c.queries.GetRateLimitCounters(ctx, []int64{currentID, previousID})
	if err != nil {
		c.logger.WarnContext(ctx, "rate limit counter unavailable, letting the request through", "error", err)
		return 0, 0, nil
	}
	for _, row := range rows {
		switch row.ID {
		case currentID:
			current = int(row.Count)
		case previousID:
			previous = int(row.Count)
		}
	}
	return current, previous, nil
}

// counterID hashes the caller and the window into the row's key, so the table
// never holds an address or a user ID.
func counterID(key string, window time.Time) int64 {
	return int64(httprate.LimitCounterKey(key, window)) //nolint:gosec // Reinterpreting the hash's bits is the intent.
}
