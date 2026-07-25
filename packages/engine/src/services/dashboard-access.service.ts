import { dashboardPasswordService } from "./dashboard-password.service.js";
import { flowsService, type FlowRecord } from "./flows.service.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

export class DashboardAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DashboardAccessError";
  }
}

/** The only part of the flows store this policy needs. */
export interface DashboardLockStore {
  updatePasswordLock(id: string, failedAttempts: number, lockUntil: Date | null): Promise<void>;
}

/** The only part of the password service this policy needs. */
export interface DashboardPasswordVerifier {
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

/**
 * The single gate every public dashboard entry point passes through.
 *
 * Publication check, throttling and password verification used to be repeated
 * inline per route, and `/trigger` carried only the verification — leaving the
 * lockout trivially bypassable by brute-forcing that endpoint instead. Keeping
 * the policy in one place is what makes "every entry point is throttled" a
 * property of the code rather than a thing to remember.
 */
export class DashboardAccessService {
  constructor(
    private readonly lockStore: DashboardLockStore = flowsService,
    private readonly passwords: DashboardPasswordVerifier = dashboardPasswordService
  ) {}

  isPasswordProtected(flow: FlowRecord): boolean {
    return Boolean(flow.dashboard_password_hash);
  }

  /**
   * Resolves if the caller may read or run this dashboard, throws
   * {@link DashboardAccessError} otherwise. A wrong password counts against the
   * flow's attempt budget no matter which endpoint it arrived on.
   */
  async assertAccess(flow: FlowRecord, password?: string): Promise<void> {
    if (!flow.is_published) {
      throw new DashboardAccessError(403, "This dashboard is not published.");
    }

    if (!flow.dashboard_password_hash) return;

    if (this.isLocked(flow)) {
      throw new DashboardAccessError(429, "Too many failed attempts. Locked for 5 minutes.");
    }

    const isMatch = await this.passwords.verifyPassword(
      String(password ?? ""),
      flow.dashboard_password_hash
    );

    if (isMatch) {
      await this.clearFailures(flow);
      return;
    }

    throw await this.recordFailure(flow);
  }

  private isLocked(flow: FlowRecord): boolean {
    const lockUntil = flow.dashboard_password_lock_until;
    return lockUntil !== null && lockUntil !== undefined && new Date(lockUntil).getTime() > Date.now();
  }

  private async clearFailures(flow: FlowRecord): Promise<void> {
    if (!flow.dashboard_password_failed_attempts && !flow.dashboard_password_lock_until) return;
    await this.lockStore.updatePasswordLock(flow.id, 0, null);
  }

  private async recordFailure(flow: FlowRecord): Promise<DashboardAccessError> {
    const attempts = (flow.dashboard_password_failed_attempts ?? 0) + 1;

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await this.lockStore.updatePasswordLock(flow.id, 0, new Date(Date.now() + LOCK_DURATION_MS));
      return new DashboardAccessError(429, "Too many failed attempts. Locked for 5 minutes.");
    }

    await this.lockStore.updatePasswordLock(flow.id, attempts, null);
    return new DashboardAccessError(401, "Incorrect password");
  }
}

export const dashboardAccessService = new DashboardAccessService();
