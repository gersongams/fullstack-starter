package clients_test

import (
	"errors"
	"sync"
	"testing"

	"github.com/gersongams/fullstack-starter/apps/api/internal/clients"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
	"github.com/gersongams/fullstack-starter/apps/api/internal/idempotency"
)

func key(t *testing.T, value string, fields clients.Fields) *idempotency.Key {
	t.Helper()
	k, err := idempotency.NewKey(value, fields)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func countClients(t *testing.T, store *clients.Store, userID string) int {
	t.Helper()
	page, err := store.List(t.Context(), userID, clients.ListParams{Limit: clients.MaxPageSize})
	if err != nil {
		t.Fatal(err)
	}
	return len(page.Items)
}

func TestCreateWithTheSameKeyReplaysInsteadOfCreatingAgain(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()
	fields := clients.Fields{Name: "Acme", TaxID: ptr("20123456789")}

	first, replayed, err := store.Create(ctx, "alice", fields, key(t, "k-1", fields))
	if err != nil || replayed {
		t.Fatalf("first create: replayed = %v, err = %v", replayed, err)
	}
	second, replayed, err := store.Create(ctx, "alice", fields, key(t, "k-1", fields))
	if err != nil {
		t.Fatalf("retry: %v (a replay must not hit the tax id constraint)", err)
	}
	if !replayed || second.ID != first.ID || !second.CreatedAt.Equal(first.CreatedAt) {
		t.Errorf("retry: replayed = %v, got %+v, want the first client %+v", replayed, second, first)
	}
	if got := countClients(t, store, "alice"); got != 1 {
		t.Errorf("alice has %d clients, want 1", got)
	}

	// Keys belong to a user: the same value from someone else is a new request.
	if _, replayed, err := store.Create(ctx, "bob", fields, key(t, "k-1", fields)); err != nil || replayed {
		t.Errorf("another user with the same key: replayed = %v, err = %v", replayed, err)
	}
}

func TestCreateRejectsAKeyReusedForADifferentRequest(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	fields := clients.Fields{Name: "Acme"}
	if _, _, err := store.Create(ctx, "alice", fields, key(t, "k-1", fields)); err != nil {
		t.Fatal(err)
	}
	other := clients.Fields{Name: "Globex"}
	if _, _, err := store.Create(ctx, "alice", other, key(t, "k-1", other)); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("err = %v, want ErrKeyReused", err)
	}
	if got := countClients(t, store, "alice"); got != 1 {
		t.Errorf("alice has %d clients, want 1", got)
	}
}

func TestCreateDoesNotRememberAFailedRequest(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	ctx := t.Context()

	taken, err := create(ctx, store, "alice", clients.Fields{Name: "Acme", TaxID: ptr("20123456789")})
	if err != nil {
		t.Fatal(err)
	}
	fields := clients.Fields{Name: "Copy", TaxID: ptr("20123456789")}
	if _, _, err := store.Create(ctx, "alice", fields, key(t, "k-1", fields)); !errors.Is(err, clients.ErrTaxIDTaken) {
		t.Fatalf("err = %v, want ErrTaxIDTaken", err)
	}

	// The conflict is gone, so the same request with the same key now succeeds:
	// the failed attempt rolled its claim back with the rest of the transaction.
	if err := store.Delete(ctx, "alice", taken.ID); err != nil {
		t.Fatal(err)
	}
	created, replayed, err := store.Create(ctx, "alice", fields, key(t, "k-1", fields))
	if err != nil || replayed || created.Name != "Copy" {
		t.Errorf("retry after the conflict cleared: client = %+v, replayed = %v, err = %v", created, replayed, err)
	}
}

func TestConcurrentCreatesWithOneKeyCreateOneClient(t *testing.T) {
	store := clients.NewStore(dbtest.New(t))
	fields := clients.Fields{Name: "Acme"}

	const attempts = 8
	ids := make([]string, attempts)
	errs := make([]error, attempts)
	var wg sync.WaitGroup
	for i := range attempts {
		wg.Go(func() {
			client, _, err := store.Create(t.Context(), "alice", fields, key(t, "double-click", fields))
			ids[i], errs[i] = client.ID.String(), err
		})
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if ids[i] != ids[0] {
			t.Errorf("attempt %d returned client %s, want %s", i, ids[i], ids[0])
		}
	}
	if got := countClients(t, store, "alice"); got != 1 {
		t.Errorf("alice has %d clients, want 1", got)
	}
}
