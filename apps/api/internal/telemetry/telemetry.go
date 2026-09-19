// Package telemetry sets up OpenTelemetry tracing. It is configured only
// through the standard OTEL_* environment variables, and stays off (no
// exporter, no sampling cost) until an OTLP endpoint is set.
package telemetry

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

// Enabled reports whether an OTLP endpoint is configured.
func Enabled() bool {
	return os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" || os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") != ""
}

// Setup installs the global tracer provider and returns its shutdown function,
// which flushes pending spans. When tracing is not configured it installs only
// the propagator, so an incoming traceparent header is still honoured and
// passed on, and the shutdown function does nothing.
func Setup(ctx context.Context, service, version string) (shutdown func(context.Context) error, err error) {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))
	if !Enabled() {
		return func(context.Context) error { return nil }, nil
	}

	// Endpoint, headers, TLS and timeouts all come from OTEL_EXPORTER_OTLP_*.
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("create OTLP trace exporter: %w", err)
	}

	// OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override these defaults.
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(service), semconv.ServiceVersion(version)),
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
	)
	if err != nil {
		return nil, fmt.Errorf("describe OTel resource: %w", err)
	}

	// The sampler comes from OTEL_TRACES_SAMPLER; the default follows the
	// caller's decision and samples every trace that starts here.
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}
