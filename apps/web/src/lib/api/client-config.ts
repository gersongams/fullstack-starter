import type { CreateClientConfig } from "./gen/client.gen";
import { getApiToken } from "./token";

// Runtime configuration of the generated API client (see openapi-ts.config.ts).
// The browser calls /api/v1/* on this origin and Next.js forwards it to the Go
// API, so there is no CORS and no API hostname in client code.
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: "",
  auth: () => getApiToken(),
});
