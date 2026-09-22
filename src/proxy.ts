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

  const { data: { session: localSession } } = await supabase.auth.getSession();
  const localUserId = localSession?.user?.id;

  const [{ data: { user } }, { data: staffResult }] = await Promise.all([
    supabase.auth.getUser(),
    localUserId
      ? supabase
          .from("staff")
          .select("role, is_active, last_login_at, deleted_at")
          .eq("id", localUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // ── /studio/login — redirect to dashboard if already valid session ──
  if (pathname === "/studio/login") {
    if (user && staffResult) {
      if (staffResult.is_active && !staffResult.deleted_at && !isSessionExpired(staffResult.last_login_at)) {
        const dest = staffResult.role === "admin" ? "/studio/admin" : "/studio/designer";
        return NextResponse.redirect(new URL(dest, request.url));
      }
      await supabase.auth.signOut();
    }
    return response.current;
  }

  // ── All other routes — require valid staff session ────────
  if (!user) {
    const loginUrl = new URL("/studio/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const staff = staffResult;

  // Not a staff member, deactivated, or soft-deleted
  if (!staff || !staff.is_active || staff.deleted_at) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/studio/login?error=access_denied", request.url));
  }

  // Session expired — sign out and redirect to login
  if (isSessionExpired(staff.last_login_at)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/studio/login?error=session_expired", request.url));
  }

  // Designers cannot access /studio/admin
  if (pathname.startsWith("/studio/admin") && staff.role !== "admin") {
    return NextResponse.redirect(new URL("/studio/designer", request.url));
  }

  // Root redirect based on role
  if (pathname === "/" || pathname === "/studio") {
    const dest = staff.role === "admin" ? "/studio/admin" : "/studio/designer";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response.current;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
