package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"github.com/gersongams/fullstack-starter/apps/api/internal/auth"
	"github.com/gersongams/fullstack-starter/apps/api/internal/clients"
	"github.com/gersongams/fullstack-starter/apps/api/internal/idempotency"
)

// ClientStore is what the client operations need from storage. Every method
// takes the caller's user ID, so an operation cannot forget to scope by owner.
type ClientStore interface {
	List(ctx context.Context, userID string, params clients.ListParams) (clients.Page, error)
	Get(ctx context.Context, userID string, id uuid.UUID) (clients.Client, error)
	Create(ctx context.Context, userID string, fields clients.Fields, key *idempotency.Key) (created clients.Client, replayed bool, err error)
	Update(ctx context.Context, userID string, id uuid.UUID, fields clients.Fields) (clients.Client, error)
	Delete(ctx context.Context, userID string, id uuid.UUID) error
}

type Client struct {
	ID        uuid.UUID `json:"id" format:"uuid" doc:"Client ID"`
	Name      string    `json:"name" doc:"Display name"`
	Email     *string   `json:"email" format:"email" doc:"Contact email, if known"`
	TaxID     *string   `json:"tax_id" doc:"Tax identification number, unique among the user's clients"`
	Notes     string    `json:"notes" doc:"Free-form notes"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ClientFields is the body of create and update. Update replaces every field.
type ClientFields struct {
	Name  string  `json:"name" minLength:"1" maxLength:"200" doc:"Display name"`
	Email *string `json:"email,omitempty" format:"email" maxLength:"320" doc:"Contact email"`
	TaxID *string `json:"tax_id,omitempty" minLength:"1" maxLength:"50" doc:"Tax identification number"`
	Notes string  `json:"notes,omitempty" maxLength:"5000" doc:"Free-form notes"`
}

// Resolve runs after schema validation: it normalises whitespace and rejects
// what the schema cannot express, so the database never sees a blank name.
func (f *ClientFields) Resolve(_ huma.Context, prefix *huma.PathBuffer) []error {
	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" {
		return []error{&huma.ErrorDetail{
			Location: prefix.With("name"),
			Message:  "must not be blank",
			Value:    f.Name,
		}}
	}
	if f.TaxID != nil {
		trimmed := strings.TrimSpace(*f.TaxID)
		f.TaxID = &trimmed
		if trimmed == "" {
			f.TaxID = nil
		}
	}
	return nil
}

func (f *ClientFields) fields() clients.Fields {
	return clients.Fields{Name: f.Name, Email: f.Email, TaxID: f.TaxID, Notes: f.Notes}
}

type ListClientsInput struct {
	Limit  int    `query:"limit" minimum:"1" maximum:"100" default:"20" doc:"Page size"`
	Cursor string `query:"cursor" doc:"Value of next_cursor from the previous page"`
	Search string `query:"q" maxLength:"200" doc:"Filter by a fragment of the name"`
}

type ListClientsOutput struct {
	Body struct {
		Items      []Client `json:"items" nullable:"false"`
		NextCursor *string  `json:"next_cursor" doc:"Pass as cursor to get the next page; null on the last page"`
	}
}

type ClientIDInput struct {
	ID uuid.UUID `path:"id" format:"uuid" doc:"Client ID"`
}

type CreateClientInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"255" doc:"Optional. A unique value per logical request, such as a UUID. Retrying with the same key returns the client created the first time instead of creating another. Keys are remembered for 24 hours."`
	Body           ClientFields
}

type UpdateClientInput struct {
	ID   uuid.UUID `path:"id" format:"uuid" doc:"Client ID"`
	Body ClientFields
}

type ClientOutput struct {
	Body Client
}

type CreateClientOutput struct {
	Location string `header:"Location"`
	Replayed string `header:"Idempotent-Replayed" doc:"\"true\" when this is the stored response of an earlier request with the same Idempotency-Key"`
	Body     Client
}

// protectedErrors are the statuses every signed-in operation can answer.
var protectedErrors = []int{http.StatusUnauthorized, http.StatusTooManyRequests, http.StatusServiceUnavailable}

func registerClients(api huma.API, store ClientStore, logger *slog.Logger) {
	const path = basePath + "/clients"
	tags := []string{"Clients"}

	// fail maps storage errors to statuses. Unknown errors are logged here and
	// answered with a generic 500, so nothing internal reaches the caller.
	fail := func(ctx context.Context, err error) error {
		switch {
		case errors.Is(err, clients.ErrNotFound):
			return huma.Error404NotFound("client not found")
		case errors.Is(err, clients.ErrTaxIDTaken):
			return huma.Error409Conflict("another client already uses this tax id")
		case errors.Is(err, idempotency.ErrKeyReused):
			return huma.Error422UnprocessableEntity("this Idempotency-Key was already used for a different request", &huma.ErrorDetail{
				Location: "header.Idempotency-Key",
				Message:  "use a new key for a new request",
			})
		default:
			logger.ErrorContext(ctx, "client operation failed", "error", err)
			return huma.Error500InternalServerError("internal error")
		}
	}

	huma.Register(api, huma.Operation{
		OperationID: "list-clients",
		Method:      http.MethodGet,
		Path:        path,
		Summary:     "List the signed-in user's clients",
		Description: "Newest first. Follow next_cursor until it is null.",
		Tags:        tags,
		Security:    auth.Required,
		Errors:      append([]int{http.StatusUnprocessableEntity}, protectedErrors...),
	}, func(ctx context.Context, in *ListClientsInput) (*ListClientsOutput, error) {
		user, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		after, err := decodeCursor(in.Cursor)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity("invalid cursor", &huma.ErrorDetail{
				Location: "query.cursor",
				Message:  "must be a next_cursor value returned by this endpoint",
				Value:    in.Cursor,
			})
		}

		page, err := store.List(ctx, user.ID, clients.ListParams{After: after, Search: in.Search, Limit: in.Limit})
		if err != nil {
			return nil, fail(ctx, err)
		}

		out := &ListClientsOutput{}
		out.Body.Items = make([]Client, 0, len(page.Items))
		for _, item := range page.Items {
			out.Body.Items = append(out.Body.Items, toClient(item))
		}
		if page.Next != nil {
			cursor := encodeCursor(*page.Next)
			out.Body.NextCursor = &cursor
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-client",
		Method:        http.MethodPost,
		Path:          path,
		Summary:       "Create a client",
		Tags:          tags,
		Security:      auth.Required,
		DefaultStatus: http.StatusCreated,
		Errors:        append([]int{http.StatusConflict, http.StatusUnprocessableEntity}, protectedErrors...),
	}, func(ctx context.Context, in *CreateClientInput) (*CreateClientOutput, error) {
		user, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		fields := in.Body.fields()
		key, err := idempotency.NewKey(in.IdempotencyKey, fields)
		if err != nil {
			return nil, fail(ctx, err)
		}
		created, replayed, err := store.Create(ctx, user.ID, fields, key)
		if err != nil {
			return nil, fail(ctx, err)
		}
		out := &CreateClientOutput{
			Location: path + "/" + created.ID.String(),
			Body:     toClient(created),
		}
		if replayed {
			out.Replayed = "true"
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-client",
		Method:      http.MethodGet,
		Path:        path + "/{id}",
		Summary:     "Get a client",
		Tags:        tags,
		Security:    auth.Required,
		Errors:      append([]int{http.StatusNotFound, http.StatusUnprocessableEntity}, protectedErrors...),
	}, func(ctx context.Context, in *ClientIDInput) (*ClientOutput, error) {
		user, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		found, err := store.Get(ctx, user.ID, in.ID)
		if err != nil {
			return nil, fail(ctx, err)
		}
		return &ClientOutput{Body: toClient(found)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-client",
		Method:      http.MethodPut,
		Path:        path + "/{id}",
		Summary:     "Replace a client's fields",
		Tags:        tags,
		Security:    auth.Required,
		Errors: append([]int{
			http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity,
		}, protectedErrors...),
	}, func(ctx context.Context, in *UpdateClientInput) (*ClientOutput, error) {
		user, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		updated, err := store.Update(ctx, user.ID, in.ID, in.Body.fields())
		if err != nil {
			return nil, fail(ctx, err)
		}
		return &ClientOutput{Body: toClient(updated)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-client",
		Method:      http.MethodDelete,
		Path:        path + "/{id}",
		Summary:     "Delete a client",
		Description: "Soft delete: the row is kept for traceability and stops appearing in the API.",
		Tags:        tags,
		Security:    auth.Required,
		Errors:      append([]int{http.StatusNotFound, http.StatusUnprocessableEntity}, protectedErrors...),
	}, func(ctx context.Context, in *ClientIDInput) (*struct{}, error) {
		user, err := caller(ctx)
		if err != nil {
			return nil, err
		}
		if err := store.Delete(ctx, user.ID, in.ID); err != nil {
			return nil, fail(ctx, err)
		}
		return nil, nil
	})
}

// caller returns the signed-in user of a protected operation.
func caller(ctx context.Context) (auth.User, error) {
	user, ok := auth.UserFrom(ctx)
	if !ok {
		return auth.User{}, huma.Error401Unauthorized("not signed in")
	}
	return user, nil
}

// Cursors are opaque to clients: the encoding can change without breaking them.
func encodeCursor(id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString(id[:])
}

func decodeCursor(cursor string) (*uuid.UUID, error) {
	if cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, err
	}
	id, err := uuid.FromBytes(raw)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func toClient(c clients.Client) Client {
	return Client{
		ID:    c.ID,
		Name:  c.Name,
		Email: c.Email,
		TaxID: c.TaxID,
		Notes: c.Notes,
		// pgx hands timestamptz back in the server's local zone. The API speaks
		// UTC, so a response does not depend on where the process runs.
		CreatedAt: c.CreatedAt.UTC(),
		UpdatedAt: c.UpdatedAt.UTC(),
	}
}
