package httpapi_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
)

func TestMetricsRecordRoutePatternsNotRawPaths(t *testing.T) {
	s := newSigner(t)
	handler, _ := httpapi.New(httpapi.Deps{
		Logger:   slog.New(slog.DiscardHandler),
		Verifier: auth.NewJWKSVerifier(s.jwksURL, testIssuer, testAudience),
		Ready:    func(context.Context) error { return nil },
		Registry: prometheus.NewRegistry(),
	})

	get := func(path string) string {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		body, _ := io.ReadAll(rec.Body)
		return string(body)
	}

	get("/api/v1/me")
	get("/api/v1/clients/0198a3f0-0000-7000-8000-000000000001")
	get("/wp-login.php")
	get("/healthz")

	metrics := get("/metrics")
	for _, want := range []string{
		`http_request_duration_seconds_count{method="GET",route="/api/v1/me",status="401"} 1`,
		`http_request_duration_seconds_count{method="GET",route="/api/v1/clients/{id}",status="401"} 1`,
		`http_request_duration_seconds_count{method="GET",route="unmatched",status="404"} 1`,
	} {
		if !strings.Contains(metrics, want) {
			t.Errorf("/metrics is missing %s", want)
		}
	}
	for _, unwanted := range []string{"wp-login", "0198a3f0", `route="/healthz"`, `route="/metrics"`} {
		if strings.Contains(metrics, unwanted) {
			t.Errorf("/metrics should not mention %q", unwanted)
		}
	}
}
