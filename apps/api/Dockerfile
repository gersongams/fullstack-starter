# Build context: apps/api
FROM golang:1.27 AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Reported as service.version on traces. The release workflow passes the tag.
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api

ENV APP_ENV=production
EXPOSE 8787
ENTRYPOINT ["/api"]
