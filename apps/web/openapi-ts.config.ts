import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../openapi/openapi.yaml",
  output: "src/lib/api/gen",
  plugins: [
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "./src/lib/api/client-config",
    },
    {
      // zod schemas for every request and response in the contract (zod.gen.ts).
      // Forms read their limits from these, so they cannot drift from the API.
      name: "zod",
      // The contract's date-time is RFC 3339, which allows an offset.
      dates: { offset: true },
    },
    {
      name: "@hey-api/sdk",
      // Responses are checked against the contract at runtime, so a web app
      // talking to an API of another version fails loudly instead of rendering
      // data of the wrong shape. Unknown extra fields are ignored, so additive
      // API changes stay compatible. Requests are not validated here: forms
      // already do it with friendlier messages, and the API is the authority.
      validator: { request: false, response: true },
    },
    {
      name: "@tanstack/react-query",
      queryOptions: true,
    },
  ],
});
