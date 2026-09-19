import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only: this checks that a session cookie exists, not that
// it is valid. Every page under (app) validates the session with
// requireSession and the Go API verifies every token, so nothing here is a
// security boundary.
//
// /sign-in and /sign-up are deliberately not matched. A stale cookie would send
// them to /dashboard, which sends an invalid session back here, forever. Those
// pages validate the session themselves instead.
//
// List every signed-in section in the matcher.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  // Remember where the visitor was going. The sign-in page validates `next`
  // with safeRedirectPath before using it.
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/dashboard/:path*", "/clients/:path*"],
};
