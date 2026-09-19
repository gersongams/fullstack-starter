// Package clients is the reference resource: rows owned by one user, stored
// through sqlc, with soft delete and cursor pagination. New resources follow
// the same shape.
package clients

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gersongams/fullstack-starter/apps/api/internal/db"
	"github.com/gersongams/fullstack-starter/apps/api/internal/db/dbgen"
	"github.com/gersongams/fullstack-starter/apps/api/internal/idempotency"
)

var (
	// ErrNotFound covers both a missing client and one owned by someone else,
	// so callers cannot probe for other users' IDs.
	ErrNotFound = errors.New("client not found")
	// ErrTaxIDTaken means the user already has a live client with that tax ID.
	ErrTaxIDTaken = errors.New("tax id already used by another client")
)

const (
	DefaultPageSize = 20
	MaxPageSize     = 100
)

const (
	uniqueViolation  = "23505"
	taxIDConstraint  = "clients_user_id_tax_id_key"
	likeEscapedChars = `\%_`
)

type Client struct {
	ID        uuid.UUID
	Name      string
	Email     *string
	TaxID     *string
	Notes     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Fields are the values a user can set on a client.
type Fields struct {
	Name  string
	Email *string
	TaxID *string
	Notes string
}

type ListParams struct {
	// After is the ID of the last client of the previous page.
	After *uuid.UUID
	// Search matches a fragment of the name, case-insensitively.
	Search string
	// Limit is clamped to 1..MaxPageSize; zero means DefaultPageSize.
	Limit int
}

type Page struct {
	Items []Client
	// Next is the After value of the following page, nil on the last one.
	Next *uuid.UUID
}

type Store struct {
	pool    *pgxpool.Pool
	queries *dbgen.Queries
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, queries: dbgen.New(pool)}
}

func (s *Store) List(ctx context.Context, userID string, params ListParams) (Page, error) {
	limit := params.Limit
	switch {
	case limit <= 0:
		limit = DefaultPageSize
	case limit > MaxPageSize:
		limit = MaxPageSize
	}

	var search *string
	if term := strings.TrimSpace(params.Search); term != "" {
		escaped := escapeLike(term)
		search = &escaped
	}

	// One extra row tells whether another page exists without a COUNT.
	rows, err := s.queries.ListClients(ctx, dbgen.ListClientsParams{
		UserID:   userID,
		After:    params.After,
		Search:   search,
		PageSize: int32(limit + 1), //nolint:gosec // limit is clamped to MaxPageSize above.
	})
	if err != nil {
		return Page{}, fmt.Errorf("list clients: %w", err)
	}

	page := Page{Items: make([]Client, 0, min(len(rows), limit))}
	for i, row := range rows {
		if i == limit {
			next := rows[limit-1].ID
			page.Next = &next
			break
		}
		page.Items = append(page.Items, fromRow(row))
	}
	return page, nil
}

func (s *Store) Get(ctx context.Context, userID string, id uuid.UUID) (Client, error) {
	row, err := s.queries.GetClient(ctx, dbgen.GetClientParams{ID: id, UserID: userID})
	if err != nil {
		return Client{}, translate("get client", err)
	}
	return fromRow(row), nil
}

// Create adds a client. With a key, a retry of the same request returns the
// client created the first time, with replayed set, instead of a second one.
// The key is claimed in the same transaction as the insert, so a failed
// create (a taken tax ID, say) leaves no key behind and can be retried.
func (s *Store) Create(ctx context.Context, userID string, fields Fields, key *idempotency.Key) (client Client, replayed bool, err error) {
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		queries := s.queries.WithTx(tx)
		client, replayed, err = idempotency.Do(ctx, queries, userID, "create-client", key, func() (Client, error) {
			row, err := queries.CreateClient(ctx, dbgen.CreateClientParams{
				UserID: userID,
				Name:   fields.Name,
				Email:  fields.Email,
				TaxID:  fields.TaxID,
				Notes:  fields.Notes,
			})
			if err != nil {
				return Client{}, translate("create client", err)
			}
			return fromRow(row), nil
		})
		return err
	})
	return client, replayed, err
}

func (s *Store) Update(ctx context.Context, userID string, id uuid.UUID, fields Fields) (Client, error) {
	row, err := s.queries.UpdateClient(ctx, dbgen.UpdateClientParams{
		ID:     id,
		UserID: userID,
		Name:   fields.Name,
		Email:  fields.Email,
		TaxID:  fields.TaxID,
		Notes:  fields.Notes,
	})
	if err != nil {
		return Client{}, translate("update client", err)
	}
	return fromRow(row), nil
}

func (s *Store) Delete(ctx context.Context, userID string, id uuid.UUID) error {
	affected, err := s.queries.SoftDeleteClient(ctx, dbgen.SoftDeleteClientParams{ID: id, UserID: userID})
	if err != nil {
		return fmt.Errorf("delete client: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// translate maps driver errors onto the package's sentinel errors, so the
// HTTP layer can choose a status without knowing about Postgres.
func translate(op string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation && pgErr.ConstraintName == taxIDConstraint {
		return ErrTaxIDTaken
	}
	return fmt.Errorf("%s: %w", op, err)
}

// escapeLike makes the user's search term literal inside an ILIKE pattern.
func escapeLike(term string) string {
	var b strings.Builder
	for _, r := range term {
		if strings.ContainsRune(likeEscapedChars, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func fromRow(row dbgen.Client) Client {
	return Client{
		ID:        row.ID,
		Name:      row.Name,
		Email:     row.Email,
		TaxID:     row.TaxID,
		Notes:     row.Notes,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}
