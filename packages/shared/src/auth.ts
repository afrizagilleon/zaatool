export const ROLES = ["creator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface AccountUser {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
}
