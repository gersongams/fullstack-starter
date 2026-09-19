package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humatest"
)

type verifierFunc func(ctx context.Context, token string) (User, error)

func (f verifierFunc) Verify(ctx context.Context, token string) (User, error) {
	return f(ctx, token)
}

func TestMiddlewareStatus(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"valid token", nil, http.StatusNoContent},
		{"invalid token", errors.New("verify token: bad signature"), http.StatusUnauthorized},
		{"keys unavailable", fmt.Errorf("%w: fetch jwks: refused", ErrKeysUnavailable), http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verifier := verifierFunc(func(context.Context, string) (User, error) {
				return User{ID: "user-123"}, tt.err
			})

			_, api := humatest.New(t)
			api.UseMiddleware(Middleware(api, verifier, slog.New(slog.DiscardHandler)))
			huma.Register(api, huma.Operation{
				OperationID: "protected",
				Method:      http.MethodGet,
				Path:        "/protected",
				Security:    Required,
			}, func(ctx context.Context, _ *struct{}) (*struct{}, error) {
				if user, ok := UserFrom(ctx); !ok || user.ID != "user-123" {
					t.Errorf("UserFrom = %+v, %v", user, ok)
				}
				return nil, nil
			})

			resp := api.Get("/protected", "Authorization: Bearer token")
			if resp.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", resp.Code, tt.wantStatus, resp.Body)
			}
		})
	}
}
