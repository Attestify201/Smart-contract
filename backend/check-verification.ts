// pages/api/check-verification.ts (Next.js API route)
// Called by miniapp when user returns from Self app (deeplinkCallback redirect).
// Checks if the user was verified by Self relayers via /api/verify.

type ApiRequest = { method?: string; body?: Record<string, unknown> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => unknown };
import { getVerification } from './lib/verification-store.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body ?? {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }

  const record = getVerification(userId);

  if (!record) {
    return res.status(200).json({
      verified: false,
      userId,
    });
  }

  return res.status(200).json({
    verified: true,
    userId,
    verifiedAt: record.verifiedAt,
    nullifier: record.nullifier,
    sessionId: req.body?.sessionId, // Echo back if frontend passed it
  });
}
