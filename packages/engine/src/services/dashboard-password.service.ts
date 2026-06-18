import bcrypt from "bcrypt";

export class DashboardPasswordService {
  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  async resolveNextHash(
    newPassword: string | undefined,
    currentHash: string | null
  ): Promise<string | null> {
    if (newPassword === undefined) return currentHash;
    if (newPassword === "[UNCHANGED]") return currentHash;
    if (!newPassword) return null;
    return this.hashPassword(newPassword);
  }
}

export const dashboardPasswordService = new DashboardPasswordService();
