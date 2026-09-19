package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

const (
	testIssuer   = "http://web.test"
	testAudience = "starter-api"
	testKeyID    = "test-key"
)

// newKey returns an EdDSA signing key and the JWKS that publishes it. Every key
// shares one key ID, so a token signed by another key fails on its signature.
func newKey(t *testing.T) (jwk.Key, jwk.Set) {
	t.Helper()

	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := jwk.Import(private)
	if err != nil {
		t.Fatal(err)
	}
	if err := key.Set(jwk.KeyIDKey, testKeyID); err != nil {
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
	return key, set
}

func signToken(t *testing.T, key jwk.Key) string {
	t.Helper()

	token, err := jwt.NewBuilder().
		Issuer(testIssuer).
		Audience([]string{testAudience}).
		Subject("user-123").
		Expiration(time.Now().Add(time.Minute)).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	signed, err := jwt.Sign(token, jwt.WithKey(jwa.EdDSA(), key))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}

// jwksServer stands in for the web app's JWKS endpoint. It counts requests and
// can be switched to fail, to serve other keys, or to block until released.
type jwksServer struct {
	url   string
	hits  atomic.Int32
	down  atomic.Bool
	block chan struct{}

	mu   sync.Mutex
	keys jwk.Set
}

func newJWKSServer(t *testing.T, keys jwk.Set) *jwksServer {
	t.Helper()

	s := &jwksServer{keys: keys}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		s.hits.Add(1)
		if s.block != nil {
			<-s.block
		}
		if s.down.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(s.keys)
	}))
	t.Cleanup(server.Close)
	s.url = server.URL
	return s
}

func (s *jwksServer) serve(keys jwk.Set) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = keys
}

// age moves the verifier's clock forward by making its last fetch look older.
func age(v *JWKSVerifier, by time.Duration) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.fetchedAt = v.fetchedAt.Add(-by)
	v.failedAt = v.failedAt.Add(-by)
}

func TestVerifyWithoutKeys(t *testing.T) {
	key, keys := newKey(t)
	server := newJWKSServer(t, keys)
	server.down.Store(true)
	v := NewJWKSVerifier(server.url, testIssuer, testAudience)
	token := signToken(t, key)

	for range 5 {
		if _, err := v.Verify(t.Context(), token); !errors.Is(err, ErrKeysUnavailable) {
			t.Fatalf("err = %v, want ErrKeysUnavailable", err)
		}
	}
	if got := server.hits.Load(); got != 1 {
		t.Fatalf("fetches while backing off = %d, want 1", got)
	}

	// Once the backoff has passed and the endpoint is back, tokens verify again.
	age(v, fetchBackoff)
	server.down.Store(false)
	if _, err := v.Verify(t.Context(), token); err != nil {
		t.Fatalf("err after recovery = %v", err)
	}
	if got := server.hits.Load(); got != 2 {
		t.Fatalf("fetches after backoff = %d, want 2", got)
	}
}

func TestVerifyServesStaleKeys(t *testing.T) {
	key, keys := newKey(t)
	server := newJWKSServer(t, keys)
	v := NewJWKSVerifier(server.url, testIssuer, testAudience)
	token := signToken(t, key)

	if _, err := v.Verify(t.Context(), token); err != nil {
		t.Fatal(err)
	}

	age(v, keySetTTL)
	server.down.Store(true)
	for range 5 {
		if _, err := v.Verify(t.Context(), token); err != nil {
			t.Fatalf("err with stale keys = %v", err)
		}
	}
	if got := server.hits.Load(); got != 2 {
		t.Fatalf("fetches = %d, want 2 (one success, one rate limited failure)", got)
	}
}

func TestVerifySharesOneFetch(t *testing.T) {
	key, keys := newKey(t)
	server := newJWKSServer(t, keys)
	server.block = make(chan struct{})
	v := NewJWKSVerifier(server.url, testIssuer, testAudience)
	token := signToken(t, key)

	const callers = 20
	errs := make(chan error, callers)
	for range callers {
		go func() {
			_, err := v.Verify(t.Context(), token)
			errs <- err
		}()
	}
	close(server.block)

	for range callers {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if got := server.hits.Load(); got != 1 {
		t.Fatalf("fetches = %d, want 1", got)
	}
}

// keySet lets countingSet embed jwk.Set, whose Set method would otherwise
// collide with the embedded field's name.
type keySet = jwk.Set

// countingSet counts key lookups, one per signature verification.
type countingSet struct {
	keySet
	lookups atomic.Int32
}

func (s *countingSet) LookupKeyID(id string) (jwk.Key, bool) {
	s.lookups.Add(1)
	return s.keySet.LookupKeyID(id)
}

func TestVerifyRetriesOnlyWithNewKeys(t *testing.T) {
	_, oldKeys := newKey(t)
	newSigningKey, newKeys := newKey(t)
	server := newJWKSServer(t, oldKeys)
	v := NewJWKSVerifier(server.url, testIssuer, testAudience)
	token := signToken(t, newSigningKey)

	cached := &countingSet{keySet: oldKeys}
	v.keys, v.fetchedAt = cached, time.Now()

	// The keys were fetched moments ago, so the token is checked once and
	// rejected without another fetch.
	if _, err := v.Verify(t.Context(), token); err == nil {
		t.Fatal("token signed by an unknown key was accepted")
	}
	if got := cached.lookups.Load(); got != 1 {
		t.Fatalf("verifications = %d, want 1", got)
	}
	if got := server.hits.Load(); got != 0 {
		t.Fatalf("fetches = %d, want 0", got)
	}

	// After a rotation the refetch brings the new key and the retry succeeds.
	server.serve(newKeys)
	age(v, minRefetch)
	if _, err := v.Verify(t.Context(), token); err != nil {
		t.Fatalf("err after key rotation = %v", err)
	}
	if got := server.hits.Load(); got != 1 {
		t.Fatalf("fetches = %d, want 1", got)
	}
}
