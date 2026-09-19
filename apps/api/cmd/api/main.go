// Command api runs the Fullstack Starter HTTP API.
//
// Usage:
//
//	api            start the HTTP server
//	api migrate    apply pending database migrations and exit
//	api openapi    print the OpenAPI 3.1 spec as YAML and exit
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/httprate"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/clients"
	"github.com/gersongams/fullstack-starter/apps/api/internal/config"
	"github.com/gersongams/fullstack-starter/apps/api/internal/db"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
	"github.com/gersongams/fullstack-starter/apps/api/internal/maintenance"
	"github.com/gersongams/fullstack-starter/apps/api/internal/telemetry"
)

const shutdownTimeout = 15 * time.Second

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// To send errors to a tracking service, pass a logging.Reporter as a fourth
	// argument. See internal/logging/reporter.go.
	logger, err := logging.New(os.Stderr, os.Getenv("APP_ENV"), os.Getenv("LOG_LEVEL"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Libraries that log through the default logger end up in the same stream.
	slog.SetDefault(logger)

	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	switch command {
	case "serve":
		err = serve(logger)
	case "migrate":
		err = migrate(logger)
	case "openapi":
		err = printOpenAPI(logger)
	default:
		err = fmt.Errorf("unknown command %q (expected serve, migrate or openapi)", command)
	}
	if err != nil {
		logger.Error("api exited", "command", command, "error", err)
		os.Exit(1)
	}
}

func serve(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	shutdownTracing, err := telemetry.Setup(ctx, "starter-api", version)
	if err != nil {
		return err
	}
	defer func() {
		// The signal context is already cancelled here; flushing needs its own.
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTracing(flushCtx); err != nil {
			logger.Warn("flush traces", "error", err)
		}
	}()
	logger.Info("tracing", "enabled", telemetry.Enabled())

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if cfg.MigrateOnStart {
		// Before listening, so no request meets an old schema. Instances that
		// start together take turns on an advisory lock inside Migrate. Better
		// Auth's own tables are not covered: `pnpm --filter web db:migrate`.
		if err := db.Migrate(ctx, pool, logger); err != nil {
			return err
		}
	}

	// Expired idempotency keys and rate-limit windows. Stops with the server.
	go maintenance.Run(ctx, pool, logger)

	var rateLimitCounter httprate.LimitCounter
	if cfg.RateLimitStore == config.RateLimitStorePostgres {
		rateLimitCounter = httpapi.NewPostgresLimitCounter(pool, logger)
	}

	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		db.NewPoolCollector(pool),
	)

	handler, _ := httpapi.New(httpapi.Deps{
		Logger:     logger,
		Verifier:   auth.NewJWKSVerifier(cfg.AuthJWKSURL, cfg.AuthIssuer, cfg.AuthAudience),
		Clients:    clients.NewStore(pool),
		Ready:      pool.Ping,
		EnableDocs: !cfg.IsProduction(),

		RateLimitPerMinute: cfg.RateLimitPerMinute,
		RateLimitCounter:   rateLimitCounter,
		TrustedProxies:     cfg.TrustedProxies,
		Registry:           registry,
	})

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("api listening", "addr", server.Addr, "env", cfg.Env)
		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		logger.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

func migrate(logger *slog.Logger) error {
	ctx := context.Background()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	pool, err := db.Connect(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	return db.Migrate(ctx, pool, logger)
}

// printOpenAPI builds the API without any live dependency, because only the
// registered operations matter for the spec.
func printOpenAPI(logger *slog.Logger) error {
	_, api := httpapi.New(httpapi.Deps{Logger: logger})

	spec, err := api.OpenAPI().YAML()
	if err != nil {
		return err
	}
	_, err = os.Stdout.Write(spec)
	return err
}
