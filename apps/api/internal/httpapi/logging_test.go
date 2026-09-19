package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
)

func TestAccessLogCarriesRequestAndUser(t *testing.T) {
	s := newSigner(t)

	var logs bytes.Buffer
	logger, err := logging.New(&logs, "production", "info")
	if err != nil {
		t.Fatal(err)
	}
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:   logger,
		Verifier: auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
		Ready:    func(context.Context) error { return nil },
	})

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+s.token(t, testAudience, time.Minute))
	req.Header.Set("X-Request-Id", "req-abc")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-Id"); got != "req-abc" {
		t.Errorf("X-Request-Id response header = %q, want req-abc", got)
	}

	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &line); err != nil {
		t.Fatalf("expected exactly one JSON log line, got %q: %v", logs.String(), err)
	}
	want := map[string]any{
		"msg":        "http request",
		"level":      "INFO",
		"service":    "api",
		"request_id": "req-abc",
		"user_id":    "user-123",
		"path":       "/api/v1/me",
		"status":     float64(http.StatusOK),
	}
	for key, value := range want {
		if line[key] != value {
			t.Errorf("log field %s = %v, want %v", key, line[key], value)
		}
	}
}

func TestSuccessfulProbesAreNotLogged(t *testing.T) {
	var logs bytes.Buffer
	logger, err := logging.New(&logs, "production", "info")
	if err != nil {
		t.Fatal(err)
	}
	handler, _ := httpapi.New(httpapi.Deps{
		Logger: logger,
		Ready:  func(context.Context) error { return nil },
	})

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/readyz", nil))

	if logs.Len() != 0 {
		t.Errorf("expected no log output for a healthy probe, got %q", logs.String())
	}
}
