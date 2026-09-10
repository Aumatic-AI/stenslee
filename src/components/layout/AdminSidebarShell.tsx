"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

interface AdminIdentity {
  name: string;
  avatar_url: string | null;
}

const NAV_ITEMS = [
  {
    href: "/studio/admin",
    label: "Dashboard",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/studio/admin/customers",
    label: "Customers",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-3.13a4 4 0 10-8 0 4 4 0 008 0zm6 3a4 4 0 10-8 0" />
      </svg>
    ),
  },
  {
    href: "/studio/admin/designers",
    label: "Designers",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h10a2 2 0 002-2v-4a2 2 0 00-2-2h-2.5M7 9h2m-2 4h2" />
      </svg>
    ),
  },
  {
    href: "/studio/admin/settings",
    label: "Settings",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/studio/admin") return pathname === "/studio/admin";
  return pathname.startsWith(href);
}

/**
 * Shows the admin sidebar/nav shell around `children` — but only for an
 * actual admin session. Every other case (designer, no session, the login
 * page) renders children directly with no shell.
 *
 * Role-driven rather than route-driven on purpose: several pages (customer
 * profile, session detail) are reached by both roles depending on where the
 * user navigated from, so a layout scoped to one folder can't correctly
 * show/hide the sidebar for those shared pages — only the actual logged-in
 * role can. The check itself runs entirely in the browser (same pattern as
 * every other page in the app) rather than trusting a server-computed value,
 * so it isn't affected by server-side Supabase connectivity issues.
 */
export default function AdminSidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);

  useEffect(() => {
    if (pathname === "/studio/login") return;
    let cancelled = false;

    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setAdmin(null); return; }

      const { data: staff } = await supabase
        .from("staff")
        .select("name, role, is_active, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!cancelled) setAdmin(staff && staff.role === "admin" && staff.is_active ? staff : null);
    }
    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pathname === "/studio/login" || !admin) {
    return <>{children}</>;
  }

  async function handleLogout() {
    // scope: "local" clears this device's session without a server round
    // trip — a dropped connection there must never leave the cookie intact.
    await supabase.auth.signOut({ scope: "local" });
    router.push("/studio/login");
    router.refresh();
  }

  return (
    <div className="h-[100dvh] bg-bg flex flex-col sm:flex-row overflow-hidden">
      {/* Sidebar — desktop/tablet. Fixed in place; only <main> scrolls. */}
      <aside className="hidden sm:flex sm:flex-col w-56 flex-shrink-0 border-r border-cleo-border bg-surface/40 px-4 py-6 gap-6 overflow-y-auto">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-7 h-7 relative flex-shrink-0">
            <Image src="/cleopatra-logo.svg" alt="Cleopatra" fill className="object-contain" />
          </div>
          <div>
            <p className="font-cinzel text-[11px] font-bold tracking-[0.15em] text-gold uppercase leading-none">Cleopatra Ink</p>
            <p className="text-[10px] font-mono text-muted tracking-wider leading-none mt-0.5">Admin Portal</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-cinzel font-bold tracking-wide transition-colors border ${
                  active
                    ? "bg-gold/10 text-gold border-gold/30"
                    : "text-muted hover:text-ink hover:bg-surface border-transparent"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <Link href="/studio/admin/settings" className="flex items-center gap-2.5 px-2 group">
            <div className="relative w-8 h-8 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center overflow-hidden flex-shrink-0">
              {admin.avatar_url ? (
                <Image src={admin.avatar_url} alt={admin.name} fill unoptimized className="object-cover" />
              ) : (
                <span className="font-cinzel text-xs font-black text-gold">{admin.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-ink text-xs font-semibold truncate group-hover:text-gold transition-colors">{admin.name}</p>
              <p className="text-muted text-[9px] font-mono uppercase tracking-wider">Admin</p>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="text-muted hover:text-error transition-colors text-xs font-mono tracking-wider px-3 py-2 rounded-lg border border-cleo-border hover:border-error/40 cursor-pointer text-left"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Top tab bar — mobile */}
      <div className="sm:hidden border-b border-cleo-border bg-surface/40 flex-shrink-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 relative flex-shrink-0">
              <Image src="/cleopatra-logo.svg" alt="Cleopatra" fill className="object-contain" />
            </div>
            <p className="font-cinzel text-[11px] font-bold tracking-[0.15em] text-gold uppercase leading-none">Cleopatra Ink</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-muted hover:text-error transition-colors text-[10px] font-mono tracking-wider px-2.5 py-1.5 rounded-lg border border-cleo-border cursor-pointer"
          >
            Logout
          </button>
        </div>
        <nav className="flex gap-1.5 px-3 pb-3 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-cinzel font-bold uppercase tracking-wider transition-colors ${
                  active ? "bg-gold text-bg" : "text-muted border border-cleo-border"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
