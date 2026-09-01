export type LabRole = "lab_owner" | "lab_admin" | "lab_member";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  isSuperAdmin: boolean;
}

export interface PublicMembership {
  labId: string;
  labName: string;
  labSlug: string;
  role: LabRole;
  status: "active" | "inactive";
}

export interface AuthContext {
  sessionId: string;
  user: PublicUser;
  memberships: PublicMembership[];
}

export interface AuthResponse {
  user: PublicUser;
  memberships: Array<Pick<PublicMembership, "labId" | "role" | "status">>;
}

export function normalizeLabRole(role: string): LabRole {
  if (role === "lab_owner" || role === "lab_admin") return role;
  return "lab_member";
}
