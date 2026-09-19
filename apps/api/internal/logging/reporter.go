package logging

import (
	"context"
	"log/slog"
)

// Reporter receives every record logged at error level: unknown errors behind
// a 500, recovered panics (with StackKey), failed dependencies. It is the one
// place to connect an error-tracking service; the repository ships none.
//
// To plug a vendor in, implement Report with its SDK and pass the value to
// New in cmd/api/main.go. The record already carries request_id, user_id and
// trace_id. By the repository's logging rule it never carries tokens, emails
// or request bodies, so forwarding it is safe; do not add them here.
//
// Report runs on the request's goroutine: hand off to the SDK's own queue and
// return, never block on the network.
type Reporter interface {
	Report(ctx context.Context, record slog.Record)
}

// reportingHandler forwards error records to a Reporter and passes every
// record on unchanged.
type reportingHandler struct {
	slog.Handler
	reporter Reporter
	// attrs are the logger's own attributes (With), which a record does not carry.
	attrs []slog.Attr
}

func (h *reportingHandler) Handle(ctx context.Context, record slog.Record) error {
	if record.Level >= slog.LevelError {
		reported := record.Clone()
		reported.AddAttrs(h.attrs...)
		h.reporter.Report(ctx, reported)
	}
	return h.Handler.Handle(ctx, record)
}

func (h *reportingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &reportingHandler{
		Handler:  h.Handler.WithAttrs(attrs),
		reporter: h.reporter,
		attrs:    append(append([]slog.Attr{}, h.attrs...), attrs...),
	}
}

func (h *reportingHandler) WithGroup(name string) slog.Handler {
	return &reportingHandler{Handler: h.Handler.WithGroup(name), reporter: h.reporter, attrs: h.attrs}
}
