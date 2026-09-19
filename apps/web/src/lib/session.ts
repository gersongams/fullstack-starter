import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "./auth";

/** The validated session of this request, or null. Cached per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/**
 * The real check for a protected page: call it at the top of every page under
 * `(app)`. proxy.ts only looks for a cookie, and a layout is not re-rendered on
 * client navigation, so neither can stand in for this.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}
