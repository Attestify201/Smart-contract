import "dotenv/config";
import { parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, createPublicClient } from "viem";
import { celo } from "viem/chains";
import type { Address } from "viem";

// Deployed contract addresses from latest deployment
// Update these if you redeployed with different addresses
const DEPLOYED_CONTRACTS = {
  vault: process.env.VAULT_ADDRESS || "0x16a0ff8d36d9d660de8fd5257cff78adf11b8306", // Vault Proxy
  strategy: process.env.STRATEGY_ADDRESS || "0x1ed36feb312b9d464d95fc1bab4b286ddc793341", // AaveV3Strategy
  asset: "0x765DE816845861e75A25fCA122bb6898B8B1282a", // cUSD on Celo Mainnet
} as const;

// Test configuration
const TEST_CONFIG = {
  depositAmount: parseUnits("1", 18), // 1 cUSD (reduced for testing)
  testUserPrivateKey: process.env.TEST_USER_PRIVATE_KEY || process.env.CELO_PRIVATE_KEY || "",
} as const;

/**
 * Test script to verify deposit functionality on deployed contracts
 * 
 * Usage:
 *   npx hardhat run scripts/test-deposit.ts --network celoMainnet
 * 
 * Environment variables:
 *   VAULT_ADDRESS - Vault proxy address (optional, uses default)
 *   STRATEGY_ADDRESS - Strategy address (optional, uses default)
 *   TEST_USER_PRIVATE_KEY - Private key for test user (optional, uses CELO_PRIVATE_KEY)
 *   CELO_MAINNET_RPC_URL - RPC URL (optional, uses default)
 */
async function main() {
  console.log("🧪 Testing Deposit Functionality on Celo Mainnet\n");
  console.log("=" .repeat(60));

  // Validate configuration
  if (!TEST_CONFIG.testUserPrivateKey) {
    throw new Error("TEST_USER_PRIVATE_KEY or CELO_PRIVATE_KEY must be set in .env");
  }

  // Setup clients
  const rpcUrl = process.env.CELO_MAINNET_RPC_URL || "https://forno.celo.org";
  const account = privateKeyToAccount(TEST_CONFIG.testUserPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });

  console.log(`\n📋 Test Configuration:`);
  console.log(`   Network: Celo Mainnet`);
  console.log(`   Test User: ${account.address}`);
  console.log(`   Vault: ${DEPLOYED_CONTRACTS.vault}`);
  console.log(`   Strategy: ${DEPLOYED_CONTRACTS.strategy}`);
  console.log(`   Asset (cUSD): ${DEPLOYED_CONTRACTS.asset}`);
  console.log(`   Deposit Amount: ${formatUnits(TEST_CONFIG.depositAmount, 18)} cUSD\n`);

  // Get contract ABIs
  const hre = await import("hardhat");
  const vaultArtifact = await hre.artifacts.readArtifact("AttestifyVault");
  
  // For cUSD, we'll use the standard ERC20 ABI
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "decimals",
      outputs: [{ name: "", type: "uint8" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  // Check initial balances
  console.log("1️⃣ Checking Initial State...");
  const initialBalance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`   User cUSD Balance: ${formatUnits(initialBalance, 18)} cUSD`);

  if (initialBalance < TEST_CONFIG.depositAmount) {
    console.error("\n❌ INSUFFICIENT BALANCE!");
    console.error(`   Required: ${formatUnits(TEST_CONFIG.depositAmount, 18)} cUSD`);
    console.error(`   Current: ${formatUnits(initialBalance, 18)} cUSD`);
    console.error(`\n📝 To fund this account:`);
    console.error(`   1. Send at least ${formatUnits(TEST_CONFIG.depositAmount, 18)} cUSD to:`);
    console.error(`      ${account.address}`);
    console.error(`   2. You can get cUSD from:`);
    console.error(`      - Celo Faucet: https://faucet.celo.org/`);
    console.error(`      - Exchange (Binance, Coinbase, etc.)`);
    console.error(`      - Bridge from another chain`);
    console.error(`   3. View account on Celoscan:`);
    console.error(`      https://celoscan.io/address/${account.address}`);
    throw new Error("Insufficient cUSD balance");
  }

  const initialVaultBalance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "totalAssets",
  });
  console.log(`   Vault Total Assets: ${formatUnits(initialVaultBalance, 18)} cUSD`);

  const initialUserShares = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "shares",
    args: [account.address],
  });
  console.log(`   User Shares: ${initialUserShares.toString()}\n`);

  // Check allowance
  console.log("2️⃣ Checking Allowance...");
  const currentAllowance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, DEPLOYED_CONTRACTS.vault],
  });
  console.log(`   Current Allowance: ${formatUnits(currentAllowance, 18)} cUSD`);

  // Approve if needed
  if (currentAllowance < TEST_CONFIG.depositAmount) {
    console.log(`   ⚠️  Insufficient allowance, approving...`);
    const approveHash = await walletClient.writeContract({
      address: DEPLOYED_CONTRACTS.asset,
      abi: erc20Abi,
      functionName: "approve",
      args: [DEPLOYED_CONTRACTS.vault, TEST_CONFIG.depositAmount],
    });
    console.log(`   📝 Approval tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`   ✅ Approval confirmed\n`);
  } else {
    console.log(`   ✅ Sufficient allowance\n`);
  }

  // Test Deposit
  console.log("3️⃣ Testing Deposit...");
  try {
    const depositHash = await walletClient.writeContract({
      address: DEPLOYED_CONTRACTS.vault,
      abi: vaultArtifact.abi,
      functionName: "deposit",
      args: [TEST_CONFIG.depositAmount],
    });
    console.log(`   📝 Deposit tx: ${depositHash}`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`   ✅ Deposit confirmed in block ${receipt.blockNumber}\n`);

    // Check results
    console.log("4️⃣ Verifying Deposit Results...");
    const newBalance = await publicClient.readContract({
      address: DEPLOYED_CONTRACTS.asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const balanceDiff = initialBalance - newBalance;
    console.log(`   User cUSD Balance: ${formatUnits(newBalance, 18)} cUSD`);
    console.log(`   Amount Deposited: ${formatUnits(balanceDiff, 18)} cUSD`);

    const newVaultBalance = await publicClient.readContract({
      address: DEPLOYED_CONTRACTS.vault,
      abi: vaultArtifact.abi,
      functionName: "totalAssets",
    });
    const vaultIncrease = newVaultBalance - initialVaultBalance;
    console.log(`   Vault Total Assets: ${formatUnits(newVaultBalance, 18)} cUSD`);
    console.log(`   Vault Increase: ${formatUnits(vaultIncrease, 18)} cUSD`);

    const newUserShares = await publicClient.readContract({
      address: DEPLOYED_CONTRACTS.vault,
      abi: vaultArtifact.abi,
      functionName: "shares",
      args: [account.address],
    });
    const sharesIssued = newUserShares - initialUserShares;
    console.log(`   User Shares: ${newUserShares.toString()}`);
    console.log(`   Shares Issued: ${sharesIssued.toString()}`);

    const userBalance = await publicClient.readContract({
      address: DEPLOYED_CONTRACTS.vault,
      abi: vaultArtifact.abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    console.log(`   User Vault Balance: ${formatUnits(userBalance, 18)} cUSD\n`);

    // Verify the deposit worked
    if (sharesIssued > 0n && vaultIncrease > 0n) {
      console.log("✅ DEPOSIT TEST PASSED!");
      console.log(`   ✓ Shares issued: ${sharesIssued.toString()}`);
      console.log(`   ✓ Vault balance increased: ${formatUnits(vaultIncrease, 18)} cUSD`);
      console.log(`   ✓ User balance in vault: ${formatUnits(userBalance, 18)} cUSD`);
    } else {
      console.log("❌ DEPOSIT TEST FAILED!");
      console.log(`   Shares issued: ${sharesIssued.toString()}`);
      console.log(`   Vault increase: ${formatUnits(vaultIncrease, 18)} cUSD`);
    }

    // Check strategy balance
    console.log("\n5️⃣ Checking Strategy Balance...");
    try {
      const strategyArtifact = await hre.artifacts.readArtifact("AaveV3Strategy");
      const strategyBalance = await publicClient.readContract({
        address: DEPLOYED_CONTRACTS.strategy,
        abi: strategyArtifact.abi,
        functionName: "totalAssets",
      });
      console.log(`   Strategy Balance: ${formatUnits(strategyBalance, 18)} cUSD`);
    } catch (error) {
      console.log(`   ⚠️  Could not read strategy balance: ${error}`);
    }

    // Get APY
    console.log("\n6️⃣ Checking Current APY...");
    try {
      const strategyArtifact = await hre.artifacts.readArtifact("AaveV3Strategy");
      const apyBasisPoints = await publicClient.readContract({
        address: DEPLOYED_CONTRACTS.strategy,
        abi: strategyArtifact.abi,
        functionName: "getCurrentAPY",
      });
      // APY is returned in basis points (e.g., 350 = 3.5%)
      // Convert to percentage: divide by 100
      const apyPercent = Number(apyBasisPoints) / 100;
      console.log(`   Current APY: ${apyPercent.toFixed(2)}%`);
    } catch (error) {
      console.log(`   ⚠️  Could not read APY: ${error}`);
    }

  } catch (error: any) {
    console.error("\n❌ DEPOSIT TEST FAILED!");
    console.error(`   Error: ${error.message || error}`);
    if (error.shortMessage) {
      console.error(`   Details: ${error.shortMessage}`);
    }
    throw error;
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 Test Complete!");
  console.log(`\nView on Celoscan:`);
  console.log(`   Vault: https://celoscan.io/address/${DEPLOYED_CONTRACTS.vault}`);
  console.log(`   User: https://celoscan.io/address/${account.address}`);
}

main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exitCode = 1;
});
