package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/clients"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
)

// clientsAPI is the real handler over a real database, called as one user.
type clientsAPI struct {
	t       *testing.T
	handler http.Handler
	signer  *signer
}

func newClientsAPI(t *testing.T) *clientsAPI {
	t.Helper()
	s := newSigner(t)
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:   slog.New(slog.DiscardHandler),
		Verifier: auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
		Clients:  clients.NewStore(dbtest.New(t)),
		Ready:    func(context.Context) error { return nil },
	})
	return &clientsAPI{t: t, handler: handler, signer: s}
}

// do sends a request as userID ("" for anonymous) and decodes a JSON response into out.
func (a *clientsAPI) do(userID, method, path string, body, out any) *httptest.ResponseRecorder {
	a.t.Helper()

	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			a.t.Fatal(err)
		}
	}
	req := httptest.NewRequestWithContext(a.t.Context(), method, path, &payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if userID != "" {
		req.Header.Set("Authorization", "Bearer "+a.signer.tokenFor(a.t, userID, testAudience, time.Minute))
	}

	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	if out != nil && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			a.t.Fatalf("%s %s: decode %q: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec
}

type clientJSON struct {
	ID        string  `json:"id"`
	CreatedAt string  `json:"created_at"`
	Name      string  `json:"name"`
	Email     *string `json:"email"`
	TaxID     *string `json:"tax_id"`
	Notes     string  `json:"notes"`
}

type listJSON struct {
	Items      []clientJSON `json:"items"`
	NextCursor *string      `json:"next_cursor"`
}

func TestClientsLifecycle(t *testing.T) {
	api := newClientsAPI(t)

	var created clientJSON
	rec := api.do("alice", http.MethodPost, "/api/v1/clients",
		map[string]any{"name": "  Acme  ", "email": "billing@acme.test", "tax_id": " 20123456789 "}, &created)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, body = %s", rec.Code, rec.Body)
	}
	if created.Name != "Acme" || created.TaxID == nil || *created.TaxID != "20123456789" {
		t.Errorf("create should trim name and tax id, got %+v", created)
	}
	if got, want := rec.Header().Get("Location"), "/api/v1/clients/"+created.ID; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
	if !strings.HasSuffix(created.CreatedAt, "Z") {
		t.Errorf("created_at = %q, want UTC (a Z suffix) whatever the server's time zone", created.CreatedAt)
	}

	var fetched clientJSON
	if rec := api.do("alice", http.MethodGet, "/api/v1/clients/"+created.ID, nil, &fetched); rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d, body = %s", rec.Code, rec.Body)
	}
	if fetched.ID != created.ID || fetched.Name != "Acme" || fetched.Email == nil || *fetched.Email != "billing@acme.test" {
		t.Errorf("get returned %+v", fetched)
	}

	var updated clientJSON
	rec = api.do("alice", http.MethodPut, "/api/v1/clients/"+created.ID,
		map[string]any{"name": "Acme Ltd", "notes": "pays late"}, &updated)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: status = %d, body = %s", rec.Code, rec.Body)
	}
	if updated.Name != "Acme Ltd" || updated.Email != nil || updated.TaxID != nil || updated.Notes != "pays late" {
		t.Errorf("update should replace every field, got %+v", updated)
	}

	if rec := api.do("alice", http.MethodDelete, "/api/v1/clients/"+created.ID, nil, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: status = %d, body = %s", rec.Code, rec.Body)
	}
	if rec := api.do("alice", http.MethodGet, "/api/v1/clients/"+created.ID, nil, nil); rec.Code != http.StatusNotFound {
		t.Errorf("get after delete: status = %d, want 404", rec.Code)
	}
}

func TestClientsAreInvisibleToOtherUsers(t *testing.T) {
	api := newClientsAPI(t)

	var created clientJSON
	if rec := api.do("alice", http.MethodPost, "/api/v1/clients", map[string]any{"name": "Acme"}, &created); rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d", rec.Code)
	}
	path := "/api/v1/clients/" + created.ID

	// 404, not 403: another user must not learn that the ID exists.
	for _, tt := range []struct {
		method string
		body   any
	}{
		{http.MethodGet, nil},
		{http.MethodPut, map[string]any{"name": "Stolen"}},
		{http.MethodDelete, nil},
	} {
		if rec := api.do("bob", tt.method, path, tt.body, nil); rec.Code != http.StatusNotFound {
			t.Errorf("%s as another user: status = %d, want 404", tt.method, rec.Code)
		}
	}

	var list listJSON
	api.do("bob", http.MethodGet, "/api/v1/clients", nil, &list)
	if len(list.Items) != 0 {
		t.Errorf("another user's list has %d clients, want 0", len(list.Items))
	}

	if rec := api.do("", http.MethodGet, "/api/v1/clients", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list: status = %d, want 401", rec.Code)
	}
}

func TestClientsRejectInvalidInput(t *testing.T) {
	api := newClientsAPI(t)

	if rec := api.do("alice", http.MethodPost, "/api/v1/clients", map[string]any{"name": "Acme", "tax_id": "20123456789"}, nil); rec.Code != http.StatusCreated {
		t.Fatalf("create: status = %d", rec.Code)
	}

	tests := []struct {
		name   string
		method string
		path   string
		body   any
		want   int
	}{
		{"missing name", http.MethodPost, "/api/v1/clients", map[string]any{}, http.StatusUnprocessableEntity},
		{"blank name", http.MethodPost, "/api/v1/clients", map[string]any{"name": "   "}, http.StatusUnprocessableEntity},
		{"long name", http.MethodPost, "/api/v1/clients", map[string]any{"name": strings.Repeat("a", 201)}, http.StatusUnprocessableEntity},
		{"bad email", http.MethodPost, "/api/v1/clients", map[string]any{"name": "A", "email": "nope"}, http.StatusUnprocessableEntity},
		{"unknown field", http.MethodPost, "/api/v1/clients", map[string]any{"name": "A", "user_id": "bob"}, http.StatusUnprocessableEntity},
		{"duplicate tax id", http.MethodPost, "/api/v1/clients", map[string]any{"name": "B", "tax_id": "20123456789"}, http.StatusConflict},
		{"bad id", http.MethodGet, "/api/v1/clients/not-a-uuid", nil, http.StatusUnprocessableEntity},
		{"bad cursor", http.MethodGet, "/api/v1/clients?cursor=%21%21", nil, http.StatusUnprocessableEntity},
		{"limit too large", http.MethodGet, "/api/v1/clients?limit=101", nil, http.StatusUnprocessableEntity},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := api.do("alice", tt.method, tt.path, tt.body, nil)
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.want, rec.Body)
			}
			if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/problem+json") {
				t.Errorf("Content-Type = %q, want problem details", got)
			}
		})
	}
}

func TestClientsListFollowsCursors(t *testing.T) {
	api := newClientsAPI(t)

	for _, name := range []string{"One", "Two", "Three"} {
		if rec := api.do("alice", http.MethodPost, "/api/v1/clients", map[string]any{"name": name}, nil); rec.Code != http.StatusCreated {
			t.Fatalf("create %s: status = %d", name, rec.Code)
		}
	}

	var names []string
	path := "/api/v1/clients?limit=2"
	for range 3 {
		var page listJSON
		if rec := api.do("alice", http.MethodGet, path, nil, &page); rec.Code != http.StatusOK {
			t.Fatalf("list: status = %d, body = %s", rec.Code, rec.Body)
		}
		for _, item := range page.Items {
			names = append(names, item.Name)
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/v1/clients?limit=2&cursor=" + *page.NextCursor
	}
	if got, want := strings.Join(names, ","), "Three,Two,One"; got != want {
		t.Errorf("clients across pages = %s, want %s", got, want)
	}

	var filtered listJSON
	api.do("alice", http.MethodGet, "/api/v1/clients?q=tw", nil, &filtered)
	if len(filtered.Items) != 1 || filtered.Items[0].Name != "Two" {
		t.Errorf("q=tw returned %+v, want only Two", filtered.Items)
	}
}

func TestCreateClientIdempotencyKey(t *testing.T) {
	api := newClientsAPI(t)

	post := func(key string, body map[string]any) (*httptest.ResponseRecorder, clientJSON) {
		t.Helper()
		var payload bytes.Buffer
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/clients", &payload)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("Authorization", "Bearer "+api.signer.tokenFor(t, "alice", testAudience, time.Minute))
		rec := httptest.NewRecorder()
		api.handler.ServeHTTP(rec, req)
		var out clientJSON
		if rec.Code == http.StatusCreated {
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return rec, out
	}

	first, created := post("req-1", map[string]any{"name": "Acme"})
	if first.Code != http.StatusCreated || first.Header().Get("Idempotent-Replayed") != "" {
		t.Fatalf("first: status = %d, replayed = %q", first.Code, first.Header().Get("Idempotent-Replayed"))
	}

	// Whitespace differences do not matter: the fingerprint is of the normalised fields.
	retry, again := post("req-1", map[string]any{"name": "  Acme "})
	if retry.Code != http.StatusCreated || retry.Header().Get("Idempotent-Replayed") != "true" || again.ID != created.ID {
		t.Errorf("retry: status = %d, replayed = %q, id = %s, want 201, true, %s",
			retry.Code, retry.Header().Get("Idempotent-Replayed"), again.ID, created.ID)
	}
	if got, want := retry.Header().Get("Location"), "/api/v1/clients/"+created.ID; got != want {
		t.Errorf("retry Location = %q, want %q", got, want)
	}

	if reused, _ := post("req-1", map[string]any{"name": "Globex"}); reused.Code != http.StatusUnprocessableEntity {
		t.Errorf("same key, different body: status = %d, want 422", reused.Code)
	}

	var list listJSON
	api.do("alice", http.MethodGet, "/api/v1/clients", nil, &list)
	if len(list.Items) != 1 {
		t.Errorf("alice has %d clients, want 1", len(list.Items))
	}
}
