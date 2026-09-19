package httpapi

import (
	"net/http"
	"net/netip"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
)

// By default counters live in memory, so each API instance enforces the limit
// on its own. With Deps.RateLimitCounter (RATE_LIMIT_STORE=postgres) the
// instances share one.
const rateLimitWindow = time.Minute

const tooManyRequestsBody = `{"title":"Too Many Requests","status":429,"detail":"rate limit exceeded, retry later"}`

func tooManyRequests(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(tooManyRequestsBody))
}

func limiterOptions(counter httprate.LimitCounter) []httprate.Option {
	options := []httprate.Option{httprate.WithLimitHandler(tooManyRequests)}
	if counter != nil {
		options = append(options, httprate.WithLimitCounter(counter))
	}
	return options
}

// limitByIP caps requests per client address before any token is verified, so
// a flood of bad tokens cannot buy unlimited signature checks. Probes are exempt.
func limitByIP(perMinute int, trustedProxies []netip.Prefix, counter httprate.LimitCounter) func(http.Handler) http.Handler {
	limiter := httprate.LimitBy(perMinute, rateLimitWindow,
		func(r *http.Request) (string, error) {
			// The prefix keeps address and user buckets apart in a shared counter.
			return "ip:" + httprate.CanonicalizeIP(middleware.GetClientIP(r.Context())), nil
		},
		limiterOptions(counter)...,
	)
	return func(next http.Handler) http.Handler {
		limited := clientIP(trustedProxies)(limiter(next))
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isProbe(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

// clientIP resolves the address the rate limit is keyed on. X-Forwarded-For is
// client-controlled, so it is read only when the connection itself comes from a
// trusted proxy (the web app, a load balancer); then the first address that is
// not a trusted proxy, walking right to left, is the client. Everything else
// is keyed on the socket address, so a caller that reaches the API directly
// cannot forge its way into another bucket.
func clientIP(trustedProxies []netip.Prefix) func(http.Handler) http.Handler {
	prefixes := make([]string, 0, len(trustedProxies))
	for _, prefix := range trustedProxies {
		prefixes = append(prefixes, prefix.String())
	}

	return func(next http.Handler) http.Handler {
		fromSocket := middleware.ClientIPFromRemoteAddr(next)
		if len(prefixes) == 0 {
			return fromSocket
		}
		// A chain that does not parse leaves no address; fall back to the socket.
		fromXFF := middleware.ClientIPFromXFF(prefixes...)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if middleware.GetClientIP(r.Context()) == "" {
				fromSocket.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		}))

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Forwarded-For") != "" && isTrusted(r.RemoteAddr, trustedProxies) {
				fromXFF.ServeHTTP(w, r)
				return
			}
			fromSocket.ServeHTTP(w, r)
		})
	}
}

func isTrusted(remoteAddr string, trustedProxies []netip.Prefix) bool {
	addrPort, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return false
	}
	addr := addrPort.Addr().Unmap().WithZone("")
	for _, prefix := range trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// limitByUser caps requests per signed-in user. It must run after the auth
// middleware. Every user behind the same address shares the IP budget, so
// this is the limit that stops one account from starving the others.
func limitByUser(perMinute int, counter httprate.LimitCounter) func(huma.Context, func(huma.Context)) {
	limiter := httprate.NewRateLimiter(perMinute, rateLimitWindow, limiterOptions(counter)...)
	return func(ctx huma.Context, next func(huma.Context)) {
		user, ok := auth.UserFrom(ctx.Context())
		if !ok {
			next(ctx)
			return
		}
		r, w := humachi.Unwrap(ctx)
		if limiter.RespondOnLimit(w, r, "user:"+user.ID) {
			return
		}
		next(ctx)
	}
}
