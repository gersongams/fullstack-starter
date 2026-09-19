// Package auth verifies the JWTs that Better Auth issues in the web app and
// exposes the authenticated user to handlers.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// User is the authenticated caller, taken from the verified token claims.
type User struct {
	ID    string
	Email string
	Name  string
}

// Verifier turns a raw bearer token into a User, or fails.
type Verifier interface {
	Verify(ctx context.Context, token string) (User, error)
}

const (
	keySetTTL = 15 * time.Minute
	// minRefetch limits how often an unknown signing key can trigger a refetch.
	minRefetch = time.Minute
	// fetchBackoff limits how often a failing JWKS endpoint is retried.
	fetchBackoff = 10 * time.Second
	clockSkew    = 30 * time.Second
)

// ErrKeysUnavailable reports that the signing keys could not be fetched and no
// earlier copy is cached, so tokens can be neither accepted nor rejected.
var ErrKeysUnavailable = errors.New("signing keys unavailable")

// JWKSVerifier verifies tokens against a remote JWKS endpoint. Keys are fetched
// lazily, so the API can start before the web app is reachable.
type JWKSVerifier struct {
	url      string
	issuer   string
	audience string
	client   *http.Client

	mu        sync.Mutex
	keys      jwk.Set
	fetchedAt time.Time
	// failedAt and fetchErr describe the last fetch when it failed.
	failedAt time.Time
	fetchErr error
	// inflight is the fetch in progress, shared by every caller that needs one.
	inflight *keyFetch
}

// keyFetch is a JWKS fetch in progress. keys and err are set before done is closed.
type keyFetch struct {
	done chan struct{}
	keys jwk.Set
	err  error
}

func NewJWKSVerifier(jwksURL, issuer, audience string) *JWKSVerifier {
	return &JWKSVerifier{
		url:      jwksURL,
		issuer:   issuer,
		audience: audience,
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

func (v *JWKSVerifier) Verify(ctx context.Context, token string) (User, error) {
	keys, err := v.keySet(ctx, keySetTTL)
	if err != nil {
		return User{}, err
	}

	parsed, err := v.parse(token, keys)
	if err != nil && !errors.Is(err, jwt.ValidateError()) {
		// The signature could not be checked, possibly because the signing key
		// was rotated. Refetch the keys (rate limited) and retry once, unless
		// the same keys come back and the result could not change.
		if fresh, fetchErr := v.keySet(ctx, minRefetch); fetchErr == nil && fresh != keys {
			parsed, err = v.parse(token, fresh)
		}
	}
	if err != nil {
		return User{}, fmt.Errorf("verify token: %w", err)
	}

	sub, ok := parsed.Subject()
	if !ok || sub == "" {
		return User{}, errors.New("verify token: missing subject")
	}
	user := User{ID: sub}
	_ = parsed.Get("email", &user.Email)
	_ = parsed.Get("name", &user.Name)
	return user, nil
}

func (v *JWKSVerifier) parse(token string, keys jwk.Set) (jwt.Token, error) {
	return jwt.Parse([]byte(token),
		jwt.WithKeySet(keys, jws.WithInferAlgorithmFromKey(true)),
		jwt.WithValidate(true),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithAcceptableSkew(clockSkew),
	)
}

// keySet returns the cached keys, refetching them when they are older than
// maxAge. Concurrent callers share one fetch, and while the JWKS endpoint is
// failing the last known keys are served and retries are rate limited.
func (v *JWKSVerifier) keySet(ctx context.Context, maxAge time.Duration) (jwk.Set, error) {
	v.mu.Lock()
	if v.keys != nil && time.Since(v.fetchedAt) < maxAge {
		defer v.mu.Unlock()
		return v.keys, nil
	}
	if v.fetchErr != nil && time.Since(v.failedAt) < fetchBackoff {
		defer v.mu.Unlock()
		return v.staleOr(v.fetchErr)
	}

	fetch := v.inflight
	if fetch == nil {
		fetch = &keyFetch{done: make(chan struct{})}
		v.inflight = fetch
		// The fetch outlives this request so a cancelled caller does not fail
		// the others waiting on it. The client timeout still bounds it.
		go v.fetch(context.WithoutCancel(ctx), fetch)
	}
	v.mu.Unlock()

	select {
	case <-fetch.done:
	case <-ctx.Done():
		return nil, fmt.Errorf("wait for jwks: %w", ctx.Err())
	}
	if fetch.err != nil {
		v.mu.Lock()
		defer v.mu.Unlock()
		return v.staleOr(fetch.err)
	}
	return fetch.keys, nil
}

// fetch downloads the JWKS without holding the lock and records the outcome.
func (v *JWKSVerifier) fetch(ctx context.Context, fetch *keyFetch) {
	fetch.keys, fetch.err = jwk.Fetch(ctx, v.url, jwk.WithHTTPClient(v.client))

	v.mu.Lock()
	if fetch.err == nil {
		v.keys, v.fetchedAt = fetch.keys, time.Now()
		v.fetchErr = nil
	} else {
		v.failedAt, v.fetchErr = time.Now(), fetch.err
	}
	v.inflight = nil
	v.mu.Unlock()

	close(fetch.done)
}

// staleOr returns the last known keys so the API keeps serving while the JWKS
// endpoint is down, or ErrKeysUnavailable when there are none. The caller must
// hold v.mu.
func (v *JWKSVerifier) staleOr(fetchErr error) (jwk.Set, error) {
	if v.keys != nil {
		return v.keys, nil
	}
	return nil, fmt.Errorf("%w: fetch jwks: %w", ErrKeysUnavailable, fetchErr)
}
