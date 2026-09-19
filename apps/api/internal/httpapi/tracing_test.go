package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/httpapi"
	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
	"github.com/gersongams/fullstack-starter/apps/api/internal/telemetry"
)

const (
	incomingTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	traceparent     = "00-" + incomingTraceID + "-00f067aa0ba902b7-01"
)

func TestTracingContinuesTheCallersTraceAndNamesSpansByRoute(t *testing.T) {
	if _, err := telemetry.Setup(t.Context(), "api-test", "test"); err != nil {
		t.Fatal(err)
	}
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })

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

	for _, path := range []string{"/api/v1/clients/0198a3f0-0000-7000-8000-000000000001", "/healthz"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		req.Header.Set("traceparent", traceparent)
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1 (probes are not traced)", len(spans))
	}
	if got, want := spans[0].Name(), "GET /api/v1/clients/{id}"; got != want {
		t.Errorf("span name = %q, want %q", got, want)
	}
	if got := spans[0].SpanContext().TraceID().String(); got != incomingTraceID {
		t.Errorf("span trace id = %s, want the caller's %s", got, incomingTraceID)
	}

	// The access log of the traced request carries the same trace ID.
	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(bytes.SplitN(logs.Bytes(), []byte("\n"), 2)[0]), &line); err != nil {
		t.Fatalf("decode log line %q: %v", logs.String(), err)
	}
	if line["trace_id"] != incomingTraceID {
		t.Errorf("log trace_id = %v, want %s", line["trace_id"], incomingTraceID)
	}
}
