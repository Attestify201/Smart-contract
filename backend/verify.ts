// pages/api/verify.ts (Next.js API route)
// Called by Self Protocol relayers when user completes verification in Self app.
// For deeplink flow: User opens Self app → verifies → relayers POST here → Self app redirects user back to miniapp.

// Use Next.js types if available; otherwise define minimal compatible types
type ApiRequest = { method?: string; body?: Record<string, unknown> };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => unknown };
import {
  SelfBackendVerifier,
  DefaultConfigStore,
  type AttestationId,
} from '@selfxyz/core';

// Allow passport (1), EU ID (2), Aadhaar (3)
const allowedIds = new Map<AttestationId, boolean>([
  [1, true],
  [2, true],
  [3, true],
]);
import { storeVerification } from './lib/verification-store.js';

const SELF_SCOPE = process.env.SELF_SCOPE || 'liquifi-miniapp-v1';
const SELF_ENDPOINT = process.env.SELF_ENDPOINT || 'https://your-domain.com/api/verify';
const MOCK_PASSPORT = process.env.SELF_MOCK_PASSPORT === 'true'; // true = Celo Sepolia testnet
const USER_ID_TYPE = (process.env.SELF_USER_ID_TYPE || 'hex') as 'hex' | 'uuid';

// Verification config - MUST match frontend SelfAppBuilder disclosures
const excludedList = process.env.SELF_EXCLUDED_COUNTRIES
  ? process.env.SELF_EXCLUDED_COUNTRIES.split(',').map((c) => c.trim())
  : ['IRN', 'PRK', 'RUS', 'SYR'];

const configStore = new DefaultConfigStore({
  minimumAge: Number(process.env.SELF_MIN_AGE || 18),
  // @ts-expect-error - Country3LetterCode[] expects literal types; runtime accepts valid ISO codes
  excludedCountries: excludedList,
  ofac: process.env.SELF_OFAC !== 'false',
});

const verifier = new SelfBackendVerifier(
  SELF_SCOPE,
  SELF_ENDPOINT,
  MOCK_PASSPORT,
  allowedIds,
  configStore,
  USER_ID_TYPE
);

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', result: false, reason: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};
    const { attestationId, proof, publicSignals, userContextData } = body as {
      attestationId?: number;
      proof?: unknown;
      publicSignals?: unknown;
      userContextData?: string;
    };

    if (!proof || !publicSignals || !attestationId || !userContextData) {
      return res.status(200).json({
        status: 'error',
        result: false,
        reason: 'Proof, publicSignals, attestationId and userContextData are required',
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await verifier.verify(attestationId as AttestationId, proof as any, publicSignals as any, userContextData);

    const { isValid, isMinimumAgeValid, isOfacValid } = result.isValidDetails;

    if (!isValid || !isMinimumAgeValid || isOfacValid) {
      let reason = 'Verification failed';
      if (!isMinimumAgeValid) reason = 'Minimum age verification failed';
      if (isOfacValid) reason = 'OFAC verification failed';
      return res.status(200).json({ status: 'error', result: false, reason });
    }

    // Store verification for check-verification endpoint
    // userIdentifier is wallet address (hex) or uuid depending on frontend config
    storeVerification({
      userIdentifier: result.userData.userIdentifier,
      nullifier: result.discloseOutput.nullifier,
      verifiedAt: Date.now(),
      attestationId: result.attestationId,
      nationality: result.discloseOutput.nationality || undefined,
    });

    return res.status(200).json({
      status: 'success',
      result: true,
    });
  } catch (error: unknown) {
    console.error('Verification error:', error);
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return res.status(200).json({
      status: 'error',
      result: false,
      reason,
    });
  }
}
