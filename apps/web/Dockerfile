# syntax=docker/dockerfile:1
# Build from the monorepo root:
#   docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:8787 -t starter-web .

FROM node:25-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter web...

FROM deps AS build
COPY apps/web apps/web
# next.config.ts bakes the /api/v1 rewrite into the build, so the API origin is a
# build argument. The other values only need to exist while Next.js loads the
# auth route at build time; the real ones are supplied at runtime.
ARG API_INTERNAL_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret \
    BETTER_AUTH_URL=http://localhost:3100 \
    SMTP_URL=smtp://localhost:1025 \
    MAIL_FROM=build@localhost
RUN pnpm --filter web build

FROM node:25-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3100
CMD ["node", "apps/web/server.js"]
