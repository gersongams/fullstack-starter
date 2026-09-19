import { jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No baseURL: the auth routes are served by this same Next.js app.
export const authClient = createAuthClient({
  plugins: [jwtClient()],
});
