package httpapi_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
)

const (
	testIssuer   = "http://web.test"
	testAudience = "starter-api"
)

// signer stands in for Better Auth: it serves a JWKS and signs EdDSA tokens.
type signer struct {
	key     jwk.Key
	jwksURL string
}

func newSigner(t *testing.T) *signer {
	t.Helper()

	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := jwk.Import(private)
	if err != nil {
		t.Fatal(err)
	}
	if err := key.Set(jwk.KeyIDKey, "test-key"); err != nil {
		t.Fatal(err)
	}
	if err := key.Set(jwk.AlgorithmKey, jwa.EdDSA()); err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}
	set := jwk.NewSet()
	if err := set.AddKey(public); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(set)
	}))
	t.Cleanup(server.Close)

	return &signer{key: key, jwksURL: server.URL}
}

func (s *signer) token(t *testing.T, audience string, expiresIn time.Duration) string {
	t.Helper()
	return s.tokenFor(t, "user-123", audience, expiresIn)
}

func (s *signer) tokenFor(t *testing.T, subject, audience string, expiresIn time.Duration) string {
	t.Helper()

	token, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{audience}).
		Subject(subject).
		IssuedAt(time.Now().Add(-time.Hour)).
		Expiration(time.Now().Add(expiresIn)).
		Claim("email", "ada@example.com").
		Claim("name", "Ada Lovelace").
		Build()
	if err != nil {
		t.Fatal(err)
	}
	signed, err := jwt.Sign(token, jwt.WithKey(jwa.EdDSA(), s.key))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}

func newHandler(jwksURL string) http.Handler {
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:   slog.New(slog.DiscardHandler),
		Verifier: auth.NewJWKSVerifier(jwksURL, testIssuer, testAudience),
		Ready:    func(context.Context) error { return nil },
	})
	return handler
}

func TestGetMe(t *testing.T) {
	s := newSigner(t)
	other := newSigner(t)
	handler := newHandler(s.jwksURL)

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{"valid token", "Bearer " + s.token(t, testAudience, time.Minute), http.StatusOK},
		{"no header", "", http.StatusUnauthorized},
		{"not a bearer token", "Basic abc", http.StatusUnauthorized},
		{"garbage token", "Bearer not-a-jwt", http.StatusUnauthorized},
		{"expired token", "Bearer " + s.token(t, testAudience, -time.Minute), http.StatusUnauthorized},
		{"wrong audience", "Bearer " + s.token(t, "another-api", time.Minute), http.StatusUnauthorized},
		{"signed by another key", "Bearer " + other.token(t, testAudience, time.Minute), http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/me", nil)
			if tt.authorization != "" {
				req.Header.Set("Authorization", tt.authorization)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantStatus, rec.Body)
			}
			if tt.wantStatus != http.StatusOK {
				return
			}

			var body struct{ ID, Email, Name string }
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.ID != "user-123" || body.Email != "ada@example.com" || body.Name != "Ada Lovelace" {
				t.Fatalf("unexpected body: %+v", body)
			}
		})
	}
}

func TestProbes(t *testing.T) {
	handler := newHandler("http://unused.test")

	for _, path := range []string{"/healthz", "/readyz"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s status = %d, want 200", path, rec.Code)
		}
	}
}
