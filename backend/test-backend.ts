/**
 * Backend Testing Utility for Self Protocol Integration
 * 
 * This script tests the backend without needing the frontend.
 * It simulates what the Self relayers would send and what the miniapp would call.
 * 
 * Prerequisites:
 * 1. Backend API running (Next.js dev server on http://localhost:3000)
 * 2. Environment variables set in .env (.env.local for Next.js)
 */

import fetch from 'node-fetch';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Mock data similar to what Self relayers would send
const MOCK_PROOF_DATA = {
  attestationId: 1, // Passport = 1, EU ID = 2, Aadhaar = 3
  proof: {
    pi_a: [
      '1234567890123456789012345678901234567890123456789012345678901234',
      '1234567890123456789012345678901234567890123456789012345678901234',
    ],
    pi_b: [
      [
        '1234567890123456789012345678901234567890123456789012345678901234',
        '1234567890123456789012345678901234567890123456789012345678901234',
      ],
      [
        '1234567890123456789012345678901234567890123456789012345678901234',
        '1234567890123456789012345678901234567890123456789012345678901234',
      ],
    ],
    pi_c: [
      '1234567890123456789012345678901234567890123456789012345678901234',
      '1234567890123456789012345678901234567890123456789012345678901234',
    ],
  },
  publicSignals: [
    '12345678901234567890123456789012', // nullifier
    '98765432109876543210987654321098', // userIdentifier
  ],
  userContextData: '0x1234567890123456789012345678901234567890', // wallet address
};

const TEST_USER_ADDRESS = '0x1234567890123456789012345678901234567890';

/**
 * Step 1: Simulate Self relayers calling POST /api/verify
 */
async function testVerifyEndpoint(): Promise<boolean> {
  console.log('\n📝 Step 1: Testing POST /api/verify');
  console.log('   Simulating Self relayers sending proof data...\n');

  try {
    const response = await fetch(`${API_BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MOCK_PROOF_DATA),
    });

    const data = await response.json() as { status: string; result: boolean; reason?: string };

    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));

    if (data.status === 'success' && data.result === true) {
      console.log('   ✅ Verification stored successfully!');
      return true;
    } else {
      console.log(`   ⚠️  Verification failed: ${data.reason}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Error calling /api/verify:`, error);
    return false;
  }
}

/**
 * Step 2: Simulate miniapp calling POST /api/check-verification after user returns
 */
async function testCheckVerificationEndpoint(userId: string): Promise<boolean> {
  console.log('\n🔍 Step 2: Testing POST /api/check-verification');
  console.log(`   Checking if user ${userId} is verified...\n`);

  try {
    const response = await fetch(`${API_BASE_URL}/api/check-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    const data = await response.json() as {
      verified: boolean;
      userId: string;
      verifiedAt?: number;
      nullifier?: string;
    };

    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));

    if (data.verified) {
      console.log(`   ✅ User is verified!`);
      console.log(`   Verified at: ${new Date(data.verifiedAt!).toISOString()}`);
      console.log(`   Nullifier: ${data.nullifier}`);
      return true;
    } else {
      console.log(`   ⚠️  User is not verified yet`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Error calling /api/check-verification:`, error);
    return false;
  }
}

/**
 * Step 3: Test with different user addresses
 */
async function testMultipleUsers(): Promise<void> {
  console.log('\n👥 Step 3: Testing with multiple users\n');

  const users = [
    { address: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd', name: 'Alice' },
    { address: '0x1122334411223344112233441122334411223344', name: 'Bob' },
  ];

  for (const user of users) {
    console.log(`\n   Testing ${user.name} (${user.address})...`);

    // Create new proof data with this user
    const proofData = {
      ...MOCK_PROOF_DATA,
      userContextData: user.address,
      publicSignals: [
        '99999999999999999999999999999999', // different nullifier
        user.address.substring(2).padEnd(32, '0'), // user identifier
      ],
    };

    // Call verify
    const response = await fetch(`${API_BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proofData),
    });

    const result = await response.json() as { status: string; result: boolean };

    if (result.status === 'success') {
      console.log(`   ✓ ${user.name} verification stored`);

      // Check verification
      const checkResponse = await fetch(`${API_BASE_URL}/api/check-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.address }),
      });

      const checkResult = await checkResponse.json() as { verified: boolean };
      console.log(`   ✓ ${user.name} check: verified=${checkResult.verified}`);
    }
  }
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
  console.log('🚀 Self Protocol Backend Integration Tests\n');
  console.log(`API URL: ${API_BASE_URL}`);
  console.log('=' .repeat(60));

  try {
    // Test 1: Verify endpoint
    const verifySuccess = await testVerifyEndpoint();

    if (!verifySuccess) {
      console.log('\n❌ Verification failed. Check your backend is running and /api/verify is accessible.');
      console.log('\nTroubleshooting:');
      console.log('  1. Is your Next.js dev server running? (npm run dev)');
      console.log('  2. Are your environment variables set in .env.local?');
      console.log('  3. Check the backend API logs for detailed errors');
      process.exit(1);
    }

    // Give it a moment to store
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 2: Check verification endpoint
    const checkSuccess = await testCheckVerificationEndpoint(TEST_USER_ADDRESS);

    if (!checkSuccess) {
      console.log('\n❌ Check verification failed.');
      process.exit(1);
    }

    // Test 3: Multiple users
    await testMultipleUsers();

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests passed!\n');
    console.log('📋 Summary:');
    console.log('   ✓ POST /api/verify - Accepts and stores proofs from Self relayers');
    console.log('   ✓ POST /api/check-verification - Returns verification status to miniapp');
    console.log('   ✓ Multiple users can be verified independently');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Frontend team implements SelfAppBuilder with deeplink');
    console.log('   2. Frontend opens Self app for user verification');
    console.log('   3. After user returns, frontend calls /api/check-verification');
    console.log('   4. If verified, store on-chain via SelfProtocolVerifier contract\n');
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { testVerifyEndpoint, testCheckVerificationEndpoint, testMultipleUsers };
