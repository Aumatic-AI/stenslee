import AdminSidebarShell from "@/components/layout/AdminSidebarShell";

// Customer profile pages are reached by both admin and designer, from
// different entry points — the sidebar shows only when the viewer is
// actually an admin (AdminSidebarShell checks this itself).
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <AdminSidebarShell>{children}</AdminSidebarShell>;
}
