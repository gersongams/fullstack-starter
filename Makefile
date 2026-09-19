.DEFAULT_GOAL := help
.PHONY: help setup db-up db-down db-reset migrate seed dev dev-api dev-web sqlc openapi generate build test e2e lint check prod-up prod-down

API := apps/api
# Pinned so everyone generates the same code. CI installs the same version and sets SQLC=sqlc.
SQLC ?= go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
# Load the API's local env file into the recipes that need it.
API_ENV := set -a && . ./.env && set +a

help: ## Show the available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

setup: ## First-time setup: env files, dependencies, database, migrations
	@test -f $(API)/.env || cp $(API)/.env.example $(API)/.env
	@test -f apps/web/.env.local || sed "s|^BETTER_AUTH_SECRET=$$|BETTER_AUTH_SECRET=$$(openssl rand -base64 32)|" apps/web/.env.example > apps/web/.env.local
	pnpm install
	$(MAKE) db-up migrate

db-up: ## Start Postgres and Mailpit and wait until they are healthy
	docker compose up -d --wait

db-down: ## Stop Postgres and Mailpit (data is kept in the volume)
	docker compose down

db-reset: ## Delete every local row: drop the Postgres volume, then migrate again
	docker compose down -v
	$(MAKE) db-up migrate

migrate: ## Apply API migrations, then Better Auth's tables
	cd $(API) && $(API_ENV) && go run ./cmd/api migrate
	pnpm --filter web db:migrate

seed: ## Create a demo account with sample clients (needs `make dev` running)
	node scripts/seed.mjs

dev: db-up migrate ## Migrate, then run both apps together through Turborepo
	pnpm dev

dev-api: ## Run only the Go API on :8787
	pnpm turbo run dev --filter=api

dev-web: ## Run only the Next.js app on :3100
	pnpm turbo run dev --filter=web

sqlc: ## Regenerate the Go query code from migrations and queries
	cd $(API) && $(SQLC) generate

openapi: sqlc ## Export the OpenAPI spec from the Go code
	@# Write to a temp file first so a failed build never truncates the committed spec.
	cd $(API) && go run ./cmd/api openapi > ../../openapi/openapi.yaml.tmp \
		&& mv ../../openapi/openapi.yaml.tmp ../../openapi/openapi.yaml \
		|| { rm -f ../../openapi/openapi.yaml.tmp; exit 1; }

generate: openapi ## Regenerate the query code, the spec and the TypeScript client
	pnpm --filter web api:generate

build: ## Build both apps
	pnpm build

test: db-up ## Run every package's tests (Go tests need Postgres; Vitest for the web app)
	pnpm test

e2e: ## Run the Playwright tests against a running `make dev`
	pnpm --filter web test:e2e

lint: ## Lint and type-check both apps
	pnpm lint

check: generate ## Fail if the committed spec or client is out of date
	@# git status, not git diff: a newly generated file that was never added must fail too.
	@changes="$$(git status --porcelain -- openapi apps/web/src/lib/api/gen $(API)/internal/db/dbgen)"; \
	if [ -n "$$changes" ]; then \
		echo "Generated files are out of date; run 'make generate' and commit:"; \
		echo "$$changes"; \
		exit 1; \
	fi

PROD_COMPOSE := docker compose -f compose.yaml -f compose.prod.yaml
# Reuse the development secret so the signing keys already in the database stay readable.
PROD_SECRET = $$(sed -n 's/^BETTER_AUTH_SECRET=//p' apps/web/.env.local)

prod-up: ## Build and run the production images locally (stop `make dev` first)
	BETTER_AUTH_SECRET="$(PROD_SECRET)" $(PROD_COMPOSE) up --build

prod-down: ## Stop the production images
	BETTER_AUTH_SECRET="$(PROD_SECRET)" $(PROD_COMPOSE) down
