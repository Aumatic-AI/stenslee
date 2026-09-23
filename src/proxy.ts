import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// API routes — pass through without session check
const PUBLIC_PREFIXES = [
  "/_next/",
  "/favicon",
  "/cleopatra-logo",
  "/placeholder",
  "/api/generate",
  "/api/upload",
  "/api/upload-ref",
  "/api/placement",
  "/api/pinterest",
  "/api/proxy-image",
];

function makeSupabaseClient(request: NextRequest, response: { current: NextResponse }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response.current = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.current.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}

function isSessionExpired(lastLogin: string | null): boolean {
  if (!lastLogin) return false; // null = first login, allow through
  return Date.now() - new Date(lastLogin).getTime() > SESSION_TIMEOUT_MS;
}

// Next.js 16 renamed the middleware.ts file convention to proxy.ts (the
// `middleware` export is deprecated and does not run) — and for a project
// using a src/ directory, this file must live inside src/ (next to app/),
// not at the project root, or it silently never executes. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = { current: NextResponse.next({ request }) };

  // ── Public paths ─────────────────────────────────────────
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return response.current;
  }

  const supabase = makeSupabaseClient(request, response);

  // getSession() decodes the JWT already sitting in the cookie -- no
  // network call in the common (non-expired-token) case, so this stays
  // reliable even where the app's own server-side fetches to Supabase are
  // flaky (see AGENTS.md's Node/Supabase note). Deliberately NOT calling
  // getUser() here: that round-trips to the Auth server to re-verify the
  // token, and on an affected machine that call can fail/never resolve
  // truthfully, which previously made every request look unauthenticated
  // and bounced it back to /studio/login in an infinite loop even with a
  // perfectly valid session.
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    if (pathname === "/studio/login") return response.current;
    const loginUrl = new URL("/studio/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // A session cookie exists and passed local JWT validation. Try the
  // richer staff-row check (role, is_active, deleted_at, 24hr timeout),
  // but degrade gracefully instead of forcing a redirect if this specific
  // network call can't complete -- the browser-side checks already run in
  // AdminSidebarShell/PermissionBootstrap re-run this same check reliably
  // (browser-side Supabase calls are unaffected), and RLS enforces
  // is_active/role at the data layer regardless of what happens here.
  //
  // Capped at 1.5s: on a machine where server-side fetches to Supabase are
  // flaky, this call doesn't cleanly fail fast -- it can hang for 5-15s
  // before ultimately erroring, which turned every navigation into a
  // multi-second stall. Aborting early and falling through to the
  // "couldn't verify" branch keeps the app responsive; it's still correct,
  // just less strict for that one request.
  const staffQueryController = new AbortController();
  const staffQueryTimeout = setTimeout(() => staffQueryController.abort(), 1500);
  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("role, is_active, last_login_at, deleted_at")
    .eq("id", session.user.id)
    .abortSignal(staffQueryController.signal)
    .maybeSingle();
  clearTimeout(staffQueryTimeout);

  const known = !staffError;
  const valid = known && !!staff && staff.is_active && !staff.deleted_at && !isSessionExpired(staff.last_login_at);

  // ── /studio/login — redirect to dashboard if already valid session ──
  if (pathname === "/studio/login") {
    if (valid) {
      const dest = staff!.role === "admin" ? "/studio/admin" : "/studio/designer";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    if (known) await supabase.auth.signOut();
    return response.current;
  }

  // Confirmed invalid (not "couldn't check") — sign out and bounce
  if (known && !valid) {
    await supabase.auth.signOut();
    const reason = staff && isSessionExpired(staff.last_login_at) ? "session_expired" : "access_denied";
    return NextResponse.redirect(new URL(`/studio/login?error=${reason}`, request.url));
  }

  // Couldn't verify (network failure) — let the request through; the
  // browser-side checks and RLS still gate the actual data.
  if (!known) return response.current;

  // Designers cannot access /studio/admin
  if (pathname.startsWith("/studio/admin") && staff!.role !== "admin") {
    return NextResponse.redirect(new URL("/studio/designer", request.url));
  }

  // Root redirect based on role
  if (pathname === "/" || pathname === "/studio") {
    const dest = staff!.role === "admin" ? "/studio/admin" : "/studio/designer";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response.current;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
