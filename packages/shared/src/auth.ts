/**
 * The two things a person can be here.
 *
 * `creator` writes, deploys, holds secrets and uploads. `viewer` opens Apps and presses
 * Run. There is deliberately no third: a role only earns its place when something checks
 * it, and everything this project needs to protect falls on one side of that line.
 *
 * It lives in `shared` rather than in the engine because the web draws different menus
 * for each of them, and a list of roles that each side keeps its own copy of is a list
 * that will disagree.
 */
export const ROLES = ["creator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * An account as anyone outside the engine sees it — never the password hash.
 *
 * `createdAt`, not `created_at`: the column name stops at the service boundary. This
 * shipped once with the engine sending `created_at` against this very declaration, and
 * nothing caught it because no screen had read the field yet.
 */
export interface AccountUser {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
}
