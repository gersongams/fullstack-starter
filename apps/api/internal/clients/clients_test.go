package clients_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/gersongams/fullstack-starter/apps/api/internal/clients"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
)

func ptr[T any](v T) *T { return &v }

// create is Create without an idempotency key.
func create(ctx context.Context, store *clients.Store, userID string, fields clients.Fields) (clients.Client, error) {
	client, _, err := store.Create(ctx, userID, fields, nil)
	return client, err
}

func TestStoreScopesEveryOperationToTheOwner(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	mine, err := create(ctx, store, "alice", clients.Fields{Name: "Acme"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.Get(ctx, "bob", mine.ID); !errors.Is(err, clients.ErrNotFound) {
		t.Errorf("Get as another user: err = %v, want ErrNotFound", err)
	}
	if _, err := store.Update(ctx, "bob", mine.ID, clients.Fields{Name: "Stolen"}); !errors.Is(err, clients.ErrNotFound) {
		t.Errorf("Update as another user: err = %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, "bob", mine.ID); !errors.Is(err, clients.ErrNotFound) {
		t.Errorf("Delete as another user: err = %v, want ErrNotFound", err)
	}
	page, err := store.List(ctx, "bob", clients.ListParams{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 0 {
		t.Errorf("List as another user returned %d clients, want 0", len(page.Items))
	}

	got, err := store.Get(ctx, "alice", mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Acme" {
		t.Errorf("owner sees name %q, want Acme (untouched by the other user)", got.Name)
	}
}

func TestStoreUpdateAndSoftDelete(t *testing.T) {
	pool := dbtest.New(t)
	store := clients.NewStore(pool)
	ctx := t.Context()

	created, err := create(ctx, store, "alice", clients.Fields{Name: "Acme", Email: ptr("old@acme.test")})
	if err != nil {
		t.Fatal(err)
	}

	updated, err := store.Update(ctx, "alice", created.ID, clients.Fields{Name: "Acme Ltd", Notes: "renamed"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Acme Ltd" || updated.Email != nil || updated.Notes != "renamed" {
		t.Errorf("update did not replace every field: %+v", updated)
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Errorf("updated_at = %v, want after %v", updated.UpdatedAt, created.UpdatedAt)
	}

	if err := store.Delete(ctx, "alice", created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, "alice", created.ID); !errors.Is(err, clients.ErrNotFound) {
		t.Errorf("Get after delete: err = %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, "alice", created.ID); !errors.Is(err, clients.ErrNotFound) {
		t.Errorf("second Delete: err = %v, want ErrNotFound", err)
	}

	var kept int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM clients WHERE id = $1 AND deleted_at IS NOT NULL", created.ID).Scan(&kept); err != nil {
		t.Fatal(err)
	}
	if kept != 1 {
		t.Errorf("soft-deleted rows kept = %d, want 1", kept)
	}
}

func TestStoreTaxIDIsUniquePerUserAmongLiveClients(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	first, err := create(ctx, store, "alice", clients.Fields{Name: "Acme", TaxID: ptr("20123456789")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := create(ctx, store, "alice", clients.Fields{Name: "Copy", TaxID: ptr("20123456789")}); !errors.Is(err, clients.ErrTaxIDTaken) {
		t.Errorf("duplicate tax id: err = %v, want ErrTaxIDTaken", err)
	}
	if _, err := create(ctx, store, "bob", clients.Fields{Name: "Acme", TaxID: ptr("20123456789")}); err != nil {
		t.Errorf("another user may use the same tax id: %v", err)
	}

	other, err := create(ctx, store, "alice", clients.Fields{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(ctx, "alice", other.ID, clients.Fields{Name: "Other", TaxID: ptr("20123456789")}); !errors.Is(err, clients.ErrTaxIDTaken) {
		t.Errorf("update to a taken tax id: err = %v, want ErrTaxIDTaken", err)
	}

	if err := store.Delete(ctx, "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := create(ctx, store, "alice", clients.Fields{Name: "Acme again", TaxID: ptr("20123456789")}); err != nil {
		t.Errorf("tax id of a deleted client should be reusable: %v", err)
	}
}

func TestStoreListPaginatesNewestFirst(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	var created []uuid.UUID
	for i := range 5 {
		c, err := create(ctx, store, "alice", clients.Fields{Name: fmt.Sprintf("Client %d", i)})
		if err != nil {
			t.Fatal(err)
		}
		created = append(created, c.ID)
	}

	var seen []uuid.UUID
	var after *uuid.UUID
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatal("pagination does not terminate")
		}
		page, err := store.List(ctx, "alice", clients.ListParams{Limit: 2, After: after})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) > 2 {
			t.Fatalf("page has %d items, want at most 2", len(page.Items))
		}
		for _, item := range page.Items {
			seen = append(seen, item.ID)
		}
		if page.Next == nil {
			break
		}
		after = page.Next
	}

	if len(seen) != len(created) {
		t.Fatalf("saw %d clients across pages, want %d", len(seen), len(created))
	}
	for i, id := range seen {
		if want := created[len(created)-1-i]; id != want {
			t.Errorf("position %d = %s, want %s (newest first, no repeats)", i, id, want)
		}
	}
}

func TestStoreSearchTreatsWildcardsLiterally(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	for _, name := range []string{"100% Organic", "1000 Islands", "Under_score", "Underscore"} {
		if _, err := create(ctx, store, "alice", clients.Fields{Name: name}); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		search string
		want   []string
	}{
		{"organic", []string{"100% Organic"}},
		{"100%", []string{"100% Organic"}},
		{"r_s", []string{"Under_score"}},
		{"  ", []string{"Underscore", "Under_score", "1000 Islands", "100% Organic"}},
	}
	for _, tt := range tests {
		page, err := store.List(ctx, "alice", clients.ListParams{Search: tt.search})
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for _, item := range page.Items {
			got = append(got, item.Name)
		}
		if fmt.Sprint(got) != fmt.Sprint(tt.want) {
			t.Errorf("search %q = %v, want %v", tt.search, got, tt.want)
		}
	}
}
