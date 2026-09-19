package db_test

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
)

// Several API instances starting at once with MIGRATE_ON_START all call
// Migrate against the same empty database.
func TestConcurrentMigrateAppliesEachMigrationOnce(t *testing.T) {
	pool := dbtest.NewEmpty(t)

	var logs bytes.Buffer
	var mu sync.Mutex
	logger := slog.New(slog.NewTextHandler(&lockedWriter{w: &logs, mu: &mu}, nil))

	const instances = 5
	errs := make([]error, instances)
	var wg sync.WaitGroup
	for i := range instances {
		wg.Go(func() { errs[i] = db.Migrate(t.Context(), pool, logger) })
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("instance %d: %v", i, err)
		}
	}

	var applied, files int
	if err := pool.QueryRow(t.Context(), `SELECT count(*), count(DISTINCT version_id) FROM goose_db_version WHERE version_id > 0`).Scan(&applied, &files); err != nil {
		t.Fatal(err)
	}
	if applied == 0 || applied != files {
		t.Errorf("goose_db_version has %d rows for %d migrations, want one row each", applied, files)
	}

	mu.Lock()
	defer mu.Unlock()
	if got := strings.Count(logs.String(), "applied migration"); got != files {
		t.Errorf("%d migrations were applied across all instances, want %d (one instance does the work)", got, files)
	}
	if got := strings.Count(logs.String(), "no pending migrations"); got != instances-1 {
		t.Errorf("%d instances found nothing to do, want %d", got, instances-1)
	}
}

type lockedWriter struct {
	w  *bytes.Buffer
	mu *sync.Mutex
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
