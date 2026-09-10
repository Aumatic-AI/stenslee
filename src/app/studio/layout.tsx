import AdminSidebarShell from "@/components/layout/AdminSidebarShell";

// Middleware already enforces auth for /studio/* — this just adds the
// persistent admin sidebar (shown only when the viewer is actually an
// admin; a no-op wrapper otherwise).
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <AdminSidebarShell>{children}</AdminSidebarShell>;
}
