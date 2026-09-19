// Package config loads the API configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

const (
	envDevelopment = "development"
	envProduction  = "production"
)

const (
	RateLimitStoreMemory   = "memory"
	RateLimitStorePostgres = "postgres"
)

type Config struct {
	// Env is "development" or "production".
	Env         string
	Port        int
	DatabaseURL string

	// AuthJWKSURL is where Better Auth publishes its public signing keys.
	AuthJWKSURL string
	// AuthIssuer and AuthAudience must match the JWT plugin config in the web app.
	AuthIssuer   string
	AuthAudience string

	// MigrateOnStart applies pending migrations before the server listens.
	MigrateOnStart bool

	// RateLimitPerMinute caps requests per caller address and per signed-in
	// user. Zero disables rate limiting.
	RateLimitPerMinute int
	// RateLimitStore is "memory" (per instance) or "postgres" (shared by
	// every instance).
	RateLimitStore string
	// TrustedProxies are the networks (the web app, load balancers) whose
	// X-Forwarded-For header is believed when rate limiting by client address.
	TrustedProxies []netip.Prefix
}

func (c Config) IsProduction() bool { return c.Env == envProduction }

func Load() (Config, error) {
	cfg := Config{
		Env:          getenv("APP_ENV", envDevelopment),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		AuthJWKSURL:  os.Getenv("AUTH_JWKS_URL"),
		AuthIssuer:   os.Getenv("AUTH_ISSUER"),
		AuthAudience: os.Getenv("AUTH_AUDIENCE"),
	}

	port, err := strconv.Atoi(getenv("PORT", "8787"))
	if err != nil {
		return Config{}, fmt.Errorf("PORT must be a number: %w", err)
	}
	if port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("PORT must be between 1 and 65535, got %d", port)
	}
	cfg.Port = port

	// On by default only in development. In production it is a decision: a slow
	// migration would hold every new instance back, so the default stays the
	// explicit `api migrate` release step.
	migrateDefault := "false"
	if cfg.Env == envDevelopment {
		migrateDefault = "true"
	}
	switch value := getenv("MIGRATE_ON_START", migrateDefault); value {
	case "true":
		cfg.MigrateOnStart = true
	case "false":
	default:
		return Config{}, fmt.Errorf("MIGRATE_ON_START must be \"true\" or \"false\", got %q", value)
	}

	rateLimit, err := strconv.Atoi(getenv("RATE_LIMIT_PER_MINUTE", "300"))
	if err != nil || rateLimit < 0 {
		return Config{}, fmt.Errorf("RATE_LIMIT_PER_MINUTE must be a number, 0 or greater, got %q", os.Getenv("RATE_LIMIT_PER_MINUTE"))
	}
	cfg.RateLimitPerMinute = rateLimit

	cfg.RateLimitStore = getenv("RATE_LIMIT_STORE", RateLimitStoreMemory)
	if cfg.RateLimitStore != RateLimitStoreMemory && cfg.RateLimitStore != RateLimitStorePostgres {
		return Config{}, fmt.Errorf("RATE_LIMIT_STORE must be %q or %q, got %q", RateLimitStoreMemory, RateLimitStorePostgres, cfg.RateLimitStore)
	}

	for _, field := range strings.FieldsFunc(os.Getenv("TRUSTED_PROXIES"), func(r rune) bool { return r == ',' || r == ' ' }) {
		prefix, err := netip.ParsePrefix(field)
		if err != nil {
			return Config{}, fmt.Errorf("TRUSTED_PROXIES must be a comma-separated list of CIDRs such as 10.0.0.0/8, got %q", field)
		}
		cfg.TrustedProxies = append(cfg.TrustedProxies, prefix.Masked())
	}

	// Anything that is not exactly "production" would otherwise run with the
	// docs endpoints on and text logs, so a typo must fail the start instead.
	if cfg.Env != envDevelopment && cfg.Env != envProduction {
		return Config{}, fmt.Errorf("APP_ENV must be %q or %q, got %q", envDevelopment, envProduction, cfg.Env)
	}

	var missing []error
	for name, value := range map[string]string{
		"DATABASE_URL":  cfg.DatabaseURL,
		"AUTH_JWKS_URL": cfg.AuthJWKSURL,
		"AUTH_ISSUER":   cfg.AuthIssuer,
		"AUTH_AUDIENCE": cfg.AuthAudience,
	} {
		if value == "" {
			missing = append(missing, fmt.Errorf("%s is required", name))
		}
	}
	if err := errors.Join(missing...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
