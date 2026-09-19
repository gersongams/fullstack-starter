// Package logging configures slog and carries request-scoped attributes
// (request ID, user ID) through the context, so every log line written with a
// *Context method can be tied back to the request that caused it.
package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"

	"github.com/lmittmann/tint"
	"go.opentelemetry.io/otel/trace"
)

// ANSI colours used by the development handler.
const (
	colorRed    = 9
	colorGreen  = 10
	colorYellow = 11
)

// New returns a logger that writes JSON in production and compact, coloured
// lines elsewhere. level is one of debug, info, warn or error; empty means info.
// Each reporter receives every error-level record; see Reporter.
func New(w io.Writer, env, level string, reporters ...Reporter) (*slog.Logger, error) {
	var lvl slog.Level
	if level != "" {
		if err := lvl.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
			return nil, fmt.Errorf("LOG_LEVEL %q is not one of debug, info, warn, error", level)
		}
	}

	var handler slog.Handler
	if env == "production" {
		handler = slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lvl})
	} else {
		handler = &stackHandler{w: w, Handler: tint.NewTextHandler(w, &tint.Options{
			Level:       lvl,
			TimeFormat:  "15:04:05.000",
			NoColor:     !useColor(w),
			ReplaceAttr: devAttr,
		})}
	}

	for _, reporter := range reporters {
		handler = &reportingHandler{Handler: handler, reporter: reporter}
	}

	// contextHandler is outermost so reporters also see the request attributes.
	return slog.New(&contextHandler{Handler: handler}).With("service", "api"), nil
}

// devNoise lists attributes that matter to log pipelines in production but
// only add clutter to a terminal.
var devNoise = map[string]bool{
	"service":     true,
	"bytes":       true,
	"remote_addr": true,
	"span_id":     true,
	"user_agent":  true,
}

// devAttr shapes attributes for the development handler: it drops the noisy
// ones, paints errors red and colours HTTP statuses by class.
func devAttr(groups []string, a slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return a
	}
	if devNoise[a.Key] {
		return slog.Attr{}
	}
	if _, ok := a.Value.Any().(error); ok {
		return tint.Attr(colorRed, a)
	}
	if a.Key == "status" && a.Value.Kind() == slog.KindInt64 {
		switch status := a.Value.Int64(); {
		case status >= 500:
			return tint.Attr(colorRed, a)
		case status >= 400:
			return tint.Attr(colorYellow, a)
		default:
			return tint.Attr(colorGreen, a)
		}
	}
	return a
}

// StackKey is the attribute that carries a stack trace. Production logs keep
// it as one JSON string; the development handler prints it as a block.
const StackKey = "stack"

// stackHandler prints a record's stack trace under its line, indented and
// unescaped, instead of as one long quoted attribute.
type stackHandler struct {
	slog.Handler
	w io.Writer
}

func (h *stackHandler) Handle(ctx context.Context, record slog.Record) error {
	var stack string
	trimmed := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
	record.Attrs(func(a slog.Attr) bool {
		if a.Key == StackKey && a.Value.Kind() == slog.KindString {
			stack = a.Value.String()
		} else {
			trimmed.AddAttrs(a)
		}
		return true
	})

	if err := h.Handler.Handle(ctx, trimmed); err != nil || stack == "" {
		return err
	}
	block := "    " + strings.ReplaceAll(strings.TrimRight(stack, "\n"), "\n", "\n    ") + "\n"
	_, err := io.WriteString(h.w, block)
	return err
}

func (h *stackHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &stackHandler{Handler: h.Handler.WithAttrs(attrs), w: h.w}
}

func (h *stackHandler) WithGroup(name string) slog.Handler {
	return &stackHandler{Handler: h.Handler.WithGroup(name), w: h.w}
}

// useColor reports whether w is a terminal that has not opted out of colour
// through NO_COLOR (https://no-color.org).
func useColor(w io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// attrBag holds the attributes of one request. It is mutable on purpose: the
// access log runs in the outermost middleware but must see attributes that
// inner layers add later, such as the authenticated user.
type attrBag struct {
	mu    sync.Mutex
	attrs []slog.Attr
}

type bagKey struct{}

// WithAttrs returns a context whose log lines carry attrs. Attributes added
// later with AddAttrs are visible to everything sharing this context.
func WithAttrs(ctx context.Context, attrs ...slog.Attr) context.Context {
	return context.WithValue(ctx, bagKey{}, &attrBag{attrs: attrs})
}

// AddAttrs attaches attrs to the current request's log lines. It does nothing
// when the context was not prepared by WithAttrs.
func AddAttrs(ctx context.Context, attrs ...slog.Attr) {
	bag, ok := ctx.Value(bagKey{}).(*attrBag)
	if !ok {
		return
	}
	bag.mu.Lock()
	defer bag.mu.Unlock()
	bag.attrs = append(bag.attrs, attrs...)
}

// contextHandler adds the request-scoped attributes to every record.
type contextHandler struct {
	slog.Handler
}

func (h *contextHandler) Handle(ctx context.Context, record slog.Record) error {
	if bag, ok := ctx.Value(bagKey{}).(*attrBag); ok {
		bag.mu.Lock()
		record.AddAttrs(bag.attrs...)
		bag.mu.Unlock()
	}
	// Ties the line to its trace. Absent unless a traceparent header arrived
	// or tracing is enabled.
	if span := trace.SpanContextFromContext(ctx); span.IsValid() {
		record.AddAttrs(
			slog.String("trace_id", span.TraceID().String()),
			slog.String("span_id", span.SpanID().String()),
		)
	}
	return h.Handler.Handle(ctx, record)
}

func (h *contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *contextHandler) WithGroup(name string) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithGroup(name)}
}
