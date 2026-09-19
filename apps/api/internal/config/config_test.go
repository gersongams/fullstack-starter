package config

import (
	"strings"
	"testing"
)

func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("APP_ENV", "")
	t.Setenv("PORT", "")
	t.Setenv("RATE_LIMIT_PER_MINUTE", "")
	t.Setenv("MIGRATE_ON_START", "")
	t.Setenv("TRUSTED_PROXIES", "")
	t.Setenv("RATE_LIMIT_STORE", "")
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("AUTH_JWKS_URL", "http://localhost:3100/api/auth/jwks")
	t.Setenv("AUTH_ISSUER", "http://localhost:3100")
	t.Setenv("AUTH_AUDIENCE", "http://localhost:8787")
}

func TestLoadDefaults(t *testing.T) {
	setRequired(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Env != "development" || cfg.IsProduction() {
		t.Errorf("Env = %q, IsProduction = %v, want development", cfg.Env, cfg.IsProduction())
	}
	if cfg.Port != 8787 {
		t.Errorf("Port = %d, want 8787", cfg.Port)
	}
	if cfg.RateLimitPerMinute != 300 {
		t.Errorf("RateLimitPerMinute = %d, want 300", cfg.RateLimitPerMinute)
	}
}

func TestLoadProduction(t *testing.T) {
	setRequired(t)
	t.Setenv("APP_ENV", "production")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.IsProduction() {
		t.Errorf("IsProduction() = false for APP_ENV=production")
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name, key, value, want string
	}{
		{"env abbreviation", "APP_ENV", "prod", "APP_ENV"},
		{"env wrong case", "APP_ENV", "Production", "APP_ENV"},
		{"env unknown", "APP_ENV", "staging", "APP_ENV"},
		{"port not a number", "PORT", "http", "PORT"},
		{"port zero", "PORT", "0", "PORT"},
		{"port negative", "PORT", "-1", "PORT"},
		{"port too large", "PORT", "65536", "PORT"},
		{"rate limit not a number", "RATE_LIMIT_PER_MINUTE", "many", "RATE_LIMIT_PER_MINUTE"},
		{"rate limit negative", "RATE_LIMIT_PER_MINUTE", "-5", "RATE_LIMIT_PER_MINUTE"},
		{"trusted proxy without a mask", "TRUSTED_PROXIES", "10.0.0.1", "TRUSTED_PROXIES"},
		{"migrate on start typo", "MIGRATE_ON_START", "yes", "MIGRATE_ON_START"},
		{"rate limit store unknown", "RATE_LIMIT_STORE", "redis", "RATE_LIMIT_STORE"},
		{"trusted proxy garbage", "TRUSTED_PROXIES", "10.0.0.0/8, web", "TRUSTED_PROXIES"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setRequired(t)
			t.Setenv(tt.key, tt.value)

			_, err := Load()
			if err == nil {
				t.Fatalf("Load() with %s=%q succeeded, want error", tt.key, tt.value)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("Load() error = %q, want it to mention %s", err, tt.want)
			}
		})
	}
}

func TestLoadReportsEveryMissingVariable(t *testing.T) {
	setRequired(t)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_ISSUER", "")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() succeeded, want error")
	}
	for _, name := range []string{"DATABASE_URL", "AUTH_ISSUER"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("Load() error = %q, want it to mention %s", err, name)
		}
	}
}

func TestMigrateOnStartDefaultsToDevelopmentOnly(t *testing.T) {
	tests := []struct {
		env, value string
		want       bool
	}{
		{"development", "", true},
		{"production", "", false},
		{"production", "true", true},
		{"development", "false", false},
	}
	for _, tt := range tests {
		t.Run(tt.env+"/"+tt.value, func(t *testing.T) {
			setRequired(t)
			t.Setenv("APP_ENV", tt.env)
			t.Setenv("MIGRATE_ON_START", tt.value)

			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.MigrateOnStart != tt.want {
				t.Errorf("MigrateOnStart = %v, want %v", cfg.MigrateOnStart, tt.want)
			}
		})
	}
}
