-- +goose Up
-- The reference resource: every row belongs to one user and is only ever
-- reached through that user's ID.
CREATE TABLE clients (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    -- auth."user".id, the token's sub. No foreign key: Better Auth creates its
    -- tables after these migrations run and owns their lifecycle.
    user_id text NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    email text,
    tax_id text,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Soft delete: a removed client stays traceable.
    deleted_at timestamptz
);

-- Owner first, then the time-ordered key: serves the paginated list.
CREATE INDEX clients_user_id_id_idx ON clients (user_id, id DESC) WHERE deleted_at IS NULL;

-- A user cannot register the same tax ID twice among their live clients.
CREATE UNIQUE INDEX clients_user_id_tax_id_key ON clients (user_id, tax_id)
    WHERE tax_id IS NOT NULL AND deleted_at IS NULL;

-- +goose Down
DROP TABLE clients;
