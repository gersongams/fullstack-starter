package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InTx runs fn inside a transaction: commit when fn returns nil, roll back
// when it returns an error or panics. Build the queries for fn with
// dbgen.New(pool).WithTx(tx), and keep the whole transaction inside one store
// method so handlers never hold one open.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	// After a commit this is a no-op; otherwise (error or panic) it undoes the
	// work. It gets its own context so a cancelled request still rolls back.
	defer func() {
		rollbackErr := tx.Rollback(context.WithoutCancel(ctx))
		if rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) && err == nil {
			err = fmt.Errorf("roll back transaction: %w", rollbackErr)
		}
	}()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
