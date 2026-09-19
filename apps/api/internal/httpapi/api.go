// Package httpapi builds the HTTP router and registers the API operations.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/netip"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
)

const (
	apiTitle   = "Fullstack Starter API"
	apiVersion = "0.1.0"
	basePath   = "/api/v1"

	requestTimeout = 30 * time.Second
)

type Deps struct {
	Logger   *slog.Logger
	Verifier auth.Verifier
	// Clients stores the clients resource. Nil only when exporting the spec.
	Clients ClientStore
	// Ready reports whether the API's dependencies (the database) are reachable.
	Ready func(ctx context.Context) error
	// EnableDocs serves the OpenAPI spec and the docs UI under /api/v1.
	EnableDocs bool
	// RateLimitPerMinute caps requests per caller address and per signed-in
	// user. Zero disables rate limiting.
	RateLimitPerMinute int
	// RateLimitCounter stores the rate-limit windows. Nil keeps them in this
	// process; NewPostgresLimitCounter shares them between instances.
	RateLimitCounter httprate.LimitCounter
	// Registry receives the HTTP metrics and is served at /metrics. Nil
	// disables both.
	Registry *prometheus.Registry
	// TrustedProxies are the networks whose X-Forwarded-For is believed when
	// working out a client's address. Empty means the socket address is used.
	TrustedProxies []netip.Prefix
}

// New returns the HTTP handler and the Huma API, which holds the OpenAPI spec.
func New(deps Deps) (http.Handler, huma.API) {
	router := chi.NewMux()
	router.Use(
		// Outermost, so every log line of the request carries the trace ID.
		tracing,
		requestContext,
		accessLog(deps.Logger),
		recoverer(deps.Logger),
	)
	if deps.Registry != nil {
		// Outside the rate limit, so rejected requests are counted too.
		router.Use(recordMetrics(deps.Registry))
	}
	if deps.RateLimitPerMinute > 0 {
		router.Use(limitByIP(deps.RateLimitPerMinute, deps.TrustedProxies, deps.RateLimitCounter))
	}
	// No CORS middleware on purpose: browsers reach the API same-origin through
	// the web app's /api/v1 rewrite, so no other origin should be allowed.
	// Request bodies are capped at 1 MiB by Huma (Operation.MaxBodyBytes).
	router.Use(
		middleware.Timeout(requestTimeout),
		middleware.SetHeader("X-Content-Type-Options", "nosniff"),
	)

	registerHealth(router, deps.Ready)
	if deps.Registry != nil {
		registerMetricsEndpoint(router, deps.Registry)
	}

	config := huma.DefaultConfig(apiTitle, apiVersion)
	config.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		auth.SecurityScheme: {Type: "http", Scheme: "bearer", BearerFormat: "JWT"},
	}
	// No schema endpoint, so drop the hook that adds "$schema" links to responses.
	config.SchemasPath = ""
	config.CreateHooks = nil
	if deps.EnableDocs {
		config.OpenAPIPath = basePath + "/openapi"
		config.DocsPath = basePath + "/docs"
	} else {
		config.OpenAPIPath = ""
		config.DocsPath = ""
	}

	api := humachi.New(router, config)
	api.UseMiddleware(auth.Middleware(api, deps.Verifier, deps.Logger))
	if deps.RateLimitPerMinute > 0 {
		api.UseMiddleware(limitByUser(deps.RateLimitPerMinute, deps.RateLimitCounter))
	}

	registerMe(api)
	registerClients(api, deps.Clients, deps.Logger)

	return router, api
}
