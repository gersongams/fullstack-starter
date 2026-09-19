-- +goose Up
-- Better Auth (in the web app) keeps its users, sessions and signing keys in
-- this schema. Its own CLI creates the tables; the API only owns the schema.
CREATE SCHEMA IF NOT EXISTS auth;

-- +goose Down
-- Deliberately a no-op. Better Auth owns everything inside this schema, so a
-- plain DROP SCHEMA fails as soon as its tables exist and CASCADE would delete
-- every user. To remove it, drop Better Auth's tables by hand first.
