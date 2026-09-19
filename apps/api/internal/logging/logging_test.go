package logging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
)

func TestNewRejectsUnknownLevel(t *testing.T) {
	if _, err := logging.New(&bytes.Buffer{}, "development", "loud"); err == nil {
		t.Fatal("expected an error for LOG_LEVEL=loud")
	}
}

func TestProductionWritesJSONWithEveryAttribute(t *testing.T) {
	var out bytes.Buffer
	logger, err := logging.New(&out, "production", "info")
	if err != nil {
		t.Fatal(err)
	}
	ctx := logging.WithAttrs(context.Background(), slog.String("request_id", "req-1"))
	logger.InfoContext(ctx, "http request", "status", 200, "user_agent", "curl")

	var line map[string]any
	if err := json.Unmarshal(out.Bytes(), &line); err != nil {
		t.Fatalf("not JSON: %q: %v", out.String(), err)
	}
	for _, key := range []string{"service", "request_id", "status", "user_agent"} {
		if _, ok := line[key]; !ok {
			t.Errorf("production log line is missing %q: %s", key, out.String())
		}
	}
}

func TestDevelopmentIsCompactAndPlainWithoutATerminal(t *testing.T) {
	var out bytes.Buffer
	logger, err := logging.New(&out, "development", "debug")
	if err != nil {
		t.Fatal(err)
	}
	ctx := logging.WithAttrs(context.Background(), slog.String("request_id", "req-1"))
	logger.WarnContext(ctx, "http request",
		"status", 401, "user_agent", "curl", "remote_addr", "[::1]:1", "bytes", 70,
		"error", errors.New("token expired"))

	line := out.String()
	for _, want := range []string{"WRN", "http request", "status=401", "request_id=req-1", `error="token expired"`} {
		if !strings.Contains(line, want) {
			t.Errorf("development log line is missing %q: %s", want, line)
		}
	}
	for _, noise := range []string{"service=", "user_agent=", "remote_addr=", "bytes=", "\x1b["} {
		if strings.Contains(line, noise) {
			t.Errorf("development log line should not contain %q: %q", noise, line)
		}
	}
}

func TestDevelopmentPrintsStackAsABlock(t *testing.T) {
	var out bytes.Buffer
	logger, err := logging.New(&out, "development", "info")
	if err != nil {
		t.Fatal(err)
	}
	logger.Error("panic while handling request", "panic", "boom",
		logging.StackKey, "goroutine 1 [running]:\nmain.handler()\n\t/app/main.go:42 +0x1d\n")

	got := out.String()
	if strings.Contains(got, `\n`) || strings.Contains(got, "stack=") {
		t.Errorf("stack should not be an escaped attribute: %q", got)
	}
	for _, want := range []string{"panic=boom\n", "\n    goroutine 1 [running]:\n", "\n    \t/app/main.go:42 +0x1d\n"} {
		if !strings.Contains(got, want) {
			t.Errorf("output is missing %q: %q", want, got)
		}
	}
}

func TestProductionKeepsStackAsOneField(t *testing.T) {
	var out bytes.Buffer
	logger, err := logging.New(&out, "production", "info")
	if err != nil {
		t.Fatal(err)
	}
	logger.Error("panic", logging.StackKey, "line one\nline two")

	var line map[string]any
	if err := json.Unmarshal(out.Bytes(), &line); err != nil {
		t.Fatalf("not one JSON line: %q: %v", out.String(), err)
	}
	if line[logging.StackKey] != "line one\nline two" {
		t.Errorf("stack = %q", line[logging.StackKey])
	}
}

type recordingReporter struct{ records []slog.Record }

func (r *recordingReporter) Report(_ context.Context, record slog.Record) {
	r.records = append(r.records, record)
}

func TestReporterReceivesOnlyErrorsWithTheirContext(t *testing.T) {
	reporter := &recordingReporter{}
	var out bytes.Buffer
	logger, err := logging.New(&out, "production", "info", reporter)
	if err != nil {
		t.Fatal(err)
	}
	ctx := logging.WithAttrs(context.Background(), slog.String("request_id", "req-1"))

	logger.WarnContext(ctx, "rejected bearer token")
	logger.ErrorContext(ctx, "client operation failed", "error", errors.New("connection refused"))

	if len(reporter.records) != 1 {
		t.Fatalf("reported %d records, want 1 (errors only)", len(reporter.records))
	}
	got := map[string]string{}
	reporter.records[0].Attrs(func(a slog.Attr) bool {
		got[a.Key] = a.Value.String()
		return true
	})
	for key, want := range map[string]string{"request_id": "req-1", "service": "api", "error": "connection refused"} {
		if got[key] != want {
			t.Errorf("reported attr %s = %q, want %q", key, got[key], want)
		}
	}
	if lines := strings.Count(out.String(), "\n"); lines != 2 {
		t.Errorf("wrote %d log lines, want 2: reporting must not swallow records", lines)
	}
}
