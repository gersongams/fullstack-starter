package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
)

type MeOutput struct {
	Body struct {
		ID    string `json:"id" doc:"User ID" example:"Yw2hX9sK1bQ"`
		Email string `json:"email" format:"email" doc:"Email address of the signed-in user"`
		Name  string `json:"name" doc:"Display name of the signed-in user"`
	}
}

func registerMe(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-me",
		Method:      http.MethodGet,
		Path:        basePath + "/me",
		Summary:     "Get the signed-in user",
		Tags:        []string{"Users"},
		Security:    auth.Required,
		Errors:      protectedErrors,
	}, func(ctx context.Context, _ *struct{}) (*MeOutput, error) {
		user, ok := auth.UserFrom(ctx)
		if !ok {
			return nil, huma.Error401Unauthorized("not signed in")
		}

		out := &MeOutput{}
		out.Body.ID = user.ID
		out.Body.Email = user.Email
		out.Body.Name = user.Name
		return out, nil
	})
}
