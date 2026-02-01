/**
 * Verification storage for Self Protocol deeplink flow.
 * Replace with your database (Postgres, Redis, etc.) in production.
 *
 * Flow: Self relayers call /api/verify → we store by userIdentifier.
 * Miniapp calls /api/check-verification after user returns from Self app.
 */
export interface VerificationRecord {
  userIdentifier: string;
  nullifier: string;
  verifiedAt: number;
  attestationId: number;
  nationality?: string;
}

const verifiedUsers = new Map<string, VerificationRecord>();

export function storeVerification(record: VerificationRecord): void {
  verifiedUsers.set(record.userIdentifier.toLowerCase(), record);
}

export function getVerification(userIdentifier: string): VerificationRecord | undefined {
  return verifiedUsers.get(userIdentifier.toLowerCase());
}

export function isVerified(userIdentifier: string): boolean {
  return verifiedUsers.has(userIdentifier.toLowerCase());
}
