package httpapi_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/dbtest"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
)

func newLimitedHandler(t *testing.T, s *signer, perMinute int) http.Handler {
	t.Helper()
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:             slog.New(slog.DiscardHandler),
		Verifier:           auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
		Ready:              func(context.Context) error { return nil },
		RateLimitPerMinute: perMinute,
		// httptest requests arrive from 192.0.2.1, standing in for the web app.
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24")},
	})
	return handler
}

func getMe(t *testing.T, handler http.Handler, ip, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/me", nil)
	if ip != "" {
		req.Header.Set("X-Forwarded-For", ip)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestRateLimitPerAddressAppliesBeforeAuth(t *testing.T) {
	handler := newLimitedHandler(t, newSigner(t), 3)

	for i := range 3 {
		if rec := getMe(t, handler, "203.0.113.7", "garbage"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: status = %d, want 401", i+1, rec.Code)
		}
	}
	rec := getMe(t, handler, "203.0.113.7", "garbage")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("request over the limit: status = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/problem+json") {
		t.Errorf("Content-Type = %q, want problem details", got)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 should carry Retry-After")
	}

	if rec := getMe(t, handler, "203.0.113.8", "garbage"); rec.Code != http.StatusUnauthorized {
		t.Errorf("another address: status = %d, want 401 (its own budget)", rec.Code)
	}
}

func TestRateLimitPerUserFollowsTheUserAcrossAddresses(t *testing.T) {
	s := newSigner(t)
	handler := newLimitedHandler(t, s, 2)
	alice := s.tokenFor(t, "alice", testAudience, time.Minute)
	bob := s.tokenFor(t, "bob", testAudience, time.Minute)

	// A new address each time, so only the per-user budget can run out.
	for i, ip := range []string{"198.51.100.1", "198.51.100.2"} {
		if rec := getMe(t, handler, ip, alice); rec.Code != http.StatusOK {
			t.Fatalf("alice request %d: status = %d, want 200", i+1, rec.Code)
		}
	}
	if rec := getMe(t, handler, "198.51.100.3", alice); rec.Code != http.StatusTooManyRequests {
		t.Errorf("alice over her limit: status = %d, want 429", rec.Code)
	}
	if rec := getMe(t, handler, "198.51.100.4", bob); rec.Code != http.StatusOK {
		t.Errorf("bob: status = %d, want 200 (his own budget)", rec.Code)
	}
}

func TestRateLimitIgnoresForwardedForFromUntrustedCallers(t *testing.T) {
	handler := newLimitedHandler(t, newSigner(t), 2)

	// Reaching the API directly and rotating the header must not buy new budgets.
	statuses := make([]int, 0, 3)
	for _, forged := range []string{"203.0.113.1", "203.0.113.2", "203.0.113.3"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/me", nil)
		req.RemoteAddr = "198.51.100.77:4711"
		req.Header.Set("X-Forwarded-For", forged)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		statuses = append(statuses, rec.Code)
	}
	if want := []int{401, 401, 429}; !slices.Equal(statuses, want) {
		t.Errorf("statuses = %v, want %v (one bucket for the socket address)", statuses, want)
	}
}

func TestRateLimitExemptsProbes(t *testing.T) {
	handler := newLimitedHandler(t, newSigner(t), 1)
	for range 5 {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.9")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("/healthz: status = %d, want 200", rec.Code)
		}
	}
}

func TestOversizedBodyIsRejected(t *testing.T) {
	api := newClientsAPI(t)
	rec := api.do("alice", http.MethodPost, "/api/v1/clients",
		map[string]any{"name": "Acme", "notes": strings.Repeat("x", 2<<20)}, nil)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("2 MiB body: status = %d, want 413", rec.Code)
	}
}

func TestNoCORSHeaders(t *testing.T) {
	handler := newLimitedHandler(t, newSigner(t), 0)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodOptions, "/api/v1/me", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want none", got)
	}
}

func TestPostgresCounterSharesTheLimitBetweenInstances(t *testing.T) {
	s := newSigner(t)
	pool := dbtest.New(t)
	logger := slog.New(slog.DiscardHandler)

	// Two handlers stand in for two API instances behind a load balancer.
	instance := func() http.Handler {
		handler, _ := httpapi.New(httpapi.Deps{
			Logger:             logger,
			Verifier:           auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
			Ready:              func(context.Context) error { return nil },
			RateLimitPerMinute: 4,
			RateLimitCounter:   httpapi.NewPostgresLimitCounter(pool, logger),
		})
		return handler
	}
	a, b := instance(), instance()

	var statuses []int
	for i := range 6 {
		handler := a
		if i%2 == 1 {
			handler = b
		}
		statuses = append(statuses, getMe(t, handler, "", "garbage").Code)
	}
	if want := []int{401, 401, 401, 401, 429, 429}; !slices.Equal(statuses, want) {
		t.Errorf("statuses across two instances = %v, want %v", statuses, want)
	}
}

func TestPostgresCounterFailsOpen(t *testing.T) {
	s := newSigner(t)
	pool := dbtest.New(t)
	logger := slog.New(slog.DiscardHandler)
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:             logger,
		Verifier:           auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
		Ready:              func(context.Context) error { return nil },
		RateLimitPerMinute: 1,
		RateLimitCounter:   httpapi.NewPostgresLimitCounter(pool, logger),
	})

	// The store is gone; the API must keep answering rather than 5xx or 429.
	pool.Close()
	for i := range 3 {
		if rec := getMe(t, handler, "", "garbage"); rec.Code != http.StatusUnauthorized {
			t.Fatalf("request %d with the counter down: status = %d, want 401", i+1, rec.Code)
		}
	}
}
