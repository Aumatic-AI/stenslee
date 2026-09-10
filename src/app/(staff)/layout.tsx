import AdminSidebarShell from "@/components/layout/AdminSidebarShell";

// Shared by /studio and /customer (a route group — doesn't affect the URL)
// so the sidebar mounts once and stays put across navigation between them.
// Previously each had its own layout wrapping the same shell, which meant
// crossing from /studio/* to /customer/* remounted it from scratch every time.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AdminSidebarShell>{children}</AdminSidebarShell>;
}
