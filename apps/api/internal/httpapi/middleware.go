package httpapi

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
)

const (
	requestIDHeader = "X-Request-Id"
	maxRequestIDLen = 64
)

// requestContext gives every request an ID, returns it to the caller, and
// attaches it to all log lines written with the request's context. An ID sent
// by a trusted proxy is reused so one ID follows the request across services.
func requestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if id == "" || len(id) > maxRequestIDLen {
			id = rand.Text()
		}
		w.Header().Set(requestIDHeader, id)

		ctx := logging.WithAttrs(r.Context(), slog.String("request_id", id))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// accessLog writes one line per request. Server errors log at error level and
// client errors at warn, so alerts can key off the level alone.
func accessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			if isProbe(r.URL.Path) && status < http.StatusBadRequest {
				// Successful probes arrive every few seconds and say nothing.
				return
			}

			level := slog.LevelInfo
			switch {
			case status >= http.StatusInternalServerError:
				level = slog.LevelError
			case status >= http.StatusBadRequest:
				level = slog.LevelWarn
			}

			logger.LogAttrs(r.Context(), level, "http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
				slog.String("remote_addr", r.RemoteAddr),
				slog.String("user_agent", r.UserAgent()),
			)
		})
	}
}

// recoverer turns a panic into a 500 and logs it with its stack trace.
func recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				recovered := recover()
				if recovered == nil {
					return
				}
				if err, ok := recovered.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					// net/http uses this value to abort a response on purpose.
					panic(recovered)
				}

				logger.ErrorContext(r.Context(), "panic while handling request",
					slog.Any("panic", recovered),
					slog.String(logging.StackKey, string(debug.Stack())),
				)
				w.WriteHeader(http.StatusInternalServerError)
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// tracing starts a server span per request, continuing the caller's trace when
// a traceparent header arrives. The route pattern is known only after
// routing, so the span is renamed once the request has been served. Probes and
// /metrics are not traced.
func tracing(next http.Handler) http.Handler {
	named := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)

		if pattern := chi.RouteContext(r.Context()).RoutePattern(); pattern != "" {
			span := trace.SpanFromContext(r.Context())
			span.SetName(r.Method + " " + pattern)
			span.SetAttributes(semconv.HTTPRoute(pattern))
		}
	})
	return otelhttp.NewHandler(named, "http.server",
		otelhttp.WithFilter(func(r *http.Request) bool { return !isProbe(r.URL.Path) }),
	)
}

func isProbe(path string) bool {
	return path == "/healthz" || path == "/readyz" || path == metricsPath
}
