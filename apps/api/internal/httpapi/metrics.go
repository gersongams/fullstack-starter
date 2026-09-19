package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const metricsPath = "/metrics"

// unmatchedRoute labels requests that hit no route. Using the raw path would
// let anyone scanning URLs create an unbounded number of time series.
const unmatchedRoute = "unmatched"

// registerMetricsEndpoint serves the registry. Like the probes it is for the
// platform: the web app only forwards /api/v1, so browsers cannot reach it.
func registerMetricsEndpoint(router chi.Router, registry *prometheus.Registry) {
	router.Method(http.MethodGet, metricsPath, promhttp.HandlerFor(registry, promhttp.HandlerOpts{Registry: registry}))
}

// recordMetrics records request durations by method, route pattern and status.
func recordMetrics(registry *prometheus.Registry) func(http.Handler) http.Handler {
	duration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Duration of HTTP requests by method, route pattern and status.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
	}, []string{"method", "route", "status"})
	inFlight := prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Requests currently being served.",
	})
	registry.MustRegister(duration, inFlight)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isProbe(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			inFlight.Inc()
			defer inFlight.Dec()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			// The pattern is known only after routing, hence after next.
			route := chi.RouteContext(r.Context()).RoutePattern()
			if route == "" {
				route = unmatchedRoute
			}
			duration.WithLabelValues(r.Method, route, strconv.Itoa(status)).Observe(time.Since(start).Seconds())
		})
	}
}
