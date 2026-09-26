// Shared staff types — safe to import in both client and server files.
export type StaffRole = "admin" | "designer";

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  avatar_key?: string | null;
  trash_last_viewed_at?: string | null;
  organization_id: string;
}
