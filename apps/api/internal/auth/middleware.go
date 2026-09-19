package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/gersongams/fullstack-starter/apps/api/internal/logging"
)

// SecurityScheme is the name of the bearer scheme in the OpenAPI spec.
// Operations opt in to authentication by listing it in their Security field.
const SecurityScheme = "bearer"

// Required is the Security value for operations that need a signed-in user.
var Required = []map[string][]string{{SecurityScheme: {}}}

type userKey struct{}

// UserFrom returns the authenticated user set by Middleware.
func UserFrom(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userKey{}).(User)
	return user, ok
}

// Middleware rejects requests without a valid bearer token on every operation
// that declares the bearer security scheme. It answers 503 instead of 401 when
// tokens cannot be verified because the signing keys are unavailable.
func Middleware(api huma.API, verifier Verifier, logger *slog.Logger) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		if !requiresAuth(ctx.Operation()) {
			next(ctx)
			return
		}

		token, ok := strings.CutPrefix(ctx.Header("Authorization"), "Bearer ")
		if !ok || token == "" {
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "missing bearer token")
			return
		}

		user, err := verifier.Verify(ctx.Context(), token)
		if errors.Is(err, ErrKeysUnavailable) {
			// The token was never checked, so this is an outage, not a bad token.
			logger.ErrorContext(ctx.Context(), "cannot verify bearer tokens", "error", err)
			_ = huma.WriteErr(api, ctx, http.StatusServiceUnavailable, "authentication is temporarily unavailable")
			return
		}
		if err != nil {
			logger.WarnContext(ctx.Context(), "rejected bearer token", "error", err)
			_ = huma.WriteErr(api, ctx, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		logging.AddAttrs(ctx.Context(), slog.String("user_id", user.ID))
		next(huma.WithValue(ctx, userKey{}, user))
	}
}

func requiresAuth(op *huma.Operation) bool {
	for _, scheme := range op.Security {
		if _, ok := scheme[SecurityScheme]; ok {
			return true
		}
	}
	return false
}
