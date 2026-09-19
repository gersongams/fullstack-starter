-- Every query filters by user_id: ownership is enforced in SQL, not in handlers.

-- name: ListClients :many
SELECT * FROM clients
WHERE user_id = @user_id
  AND deleted_at IS NULL
  AND (sqlc.narg('after')::uuid IS NULL OR id < sqlc.narg('after')::uuid)
  AND (sqlc.narg('search')::text IS NULL OR name ILIKE '%' || sqlc.narg('search')::text || '%')
ORDER BY id DESC
LIMIT @page_size;

-- name: GetClient :one
SELECT * FROM clients
WHERE id = @id AND user_id = @user_id AND deleted_at IS NULL;

-- name: CreateClient :one
INSERT INTO clients (user_id, name, email, tax_id, notes)
VALUES (@user_id, @name, @email, @tax_id, @notes)
RETURNING *;

-- name: UpdateClient :one
UPDATE clients
SET name = @name,
    email = @email,
    tax_id = @tax_id,
    notes = @notes,
    updated_at = now()
WHERE id = @id AND user_id = @user_id AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteClient :execrows
UPDATE clients
SET deleted_at = now(), updated_at = now()
WHERE id = @id AND user_id = @user_id AND deleted_at IS NULL;
