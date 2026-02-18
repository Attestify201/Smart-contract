import "dotenv/config";
import { formatUnits, parseUnits } from "viem";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import type { Address } from "viem";
import fs from "fs";
import path from "path";

// Deployed contract addresses
const DEPLOYED_CONTRACTS = {
  vault: process.env.VAULT_ADDRESS || "0x16a0ff8d36d9d660de8fd5257cff78adf11b8306",
  strategy: process.env.STRATEGY_ADDRESS || "0x1ed36feb312b9d464d95fc1bab4b286ddc793341",
  asset: "0x765DE816845861e75A25fCA122bb6898B8B1282a", // cUSD
} as const;

// Snapshot file to track historical data
const SNAPSHOT_FILE = path.join(process.cwd(), "yield-snapshots.json");

interface YieldSnapshot {
  timestamp: number;
  date: string;
  strategyBalance: string;
  vaultTotalAssets: string;
  vaultReserve: string;
  totalDeposited: string;
  totalYield: string;
  yieldPercentage: string;
  apy: string;
  userEarnings?: Record<string, string>;
}

/**
 * Load previous snapshots
 */
function loadSnapshots(): YieldSnapshot[] {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const data = fs.readFileSync(SNAPSHOT_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("⚠️  Could not load previous snapshots:", error);
  }
  return [];
}

/**
 * Save snapshot
 */
function saveSnapshot(snapshot: YieldSnapshot) {
  const snapshots = loadSnapshots();
  snapshots.push(snapshot);
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2));
  console.log(`\n💾 Snapshot saved to ${SNAPSHOT_FILE}`);
}

/**
 * Track yield accumulation on deployed contracts
 * 
 * Usage:
 *   npx hardhat run scripts/track-yield.ts --network celoMainnet
 * 
 * Optional: Pass user addresses as arguments to track specific users
 *   npx hardhat run scripts/track-yield.ts --network celoMainnet -- 0x123... 0x456...
 */
async function main() {
  console.log("📊 Yield Tracking Dashboard\n");
  console.log("=".repeat(60));

  // Setup clients
  const rpcUrl = process.env.CELO_MAINNET_RPC_URL || "https://forno.celo.org";
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });

  // Get user addresses from command line args or use empty array
  const userAddresses: Address[] = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("0x"))
    .map((arg) => arg as Address);

  console.log(`\n📋 Configuration:`);
  console.log(`   Network: Celo Mainnet`);
  console.log(`   Vault: ${DEPLOYED_CONTRACTS.vault}`);
  console.log(`   Strategy: ${DEPLOYED_CONTRACTS.strategy}`);
  console.log(`   Asset: ${DEPLOYED_CONTRACTS.asset} (cUSD)\n`);

  // Get contract ABIs
  const hre = await import("hardhat");
  const vaultArtifact = await hre.artifacts.readArtifact("AttestifyVault");
  const strategyArtifact = await hre.artifacts.readArtifact("AaveV3Strategy");

  // ERC20 ABI for checking reserve balance
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  console.log("🔍 Fetching Current State...\n");

  // 1. Strategy Balance (aToken balance - includes accrued interest)
  const strategyBalance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.strategy,
    abi: strategyArtifact.abi,
    functionName: "totalAssets",
  });

  // 2. Vault Reserve Balance (cUSD held in vault)
  const vaultReserve = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [DEPLOYED_CONTRACTS.vault],
  });

  // 3. Vault Total Assets (reserve + strategy)
  const vaultTotalAssets = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "totalAssets",
  });

  // 4. Total Deposited (cumulative deposits)
  const totalDeposited = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "totalDeposited",
  });

  // 5. Current APY (in basis points, convert to percentage)
  let apy = "0";
  try {
    const apyBasisPoints = await publicClient.readContract({
      address: DEPLOYED_CONTRACTS.strategy,
      abi: strategyArtifact.abi,
      functionName: "getCurrentAPY",
    });
    // APY is returned in basis points (e.g., 350 = 3.5%)
    // Convert to percentage: divide by 100
    apy = (Number(apyBasisPoints) / 100).toFixed(2);
  } catch (error) {
    console.warn("⚠️  Could not fetch APY:", error);
  }

  // Calculate yield
  const totalYield = vaultTotalAssets > totalDeposited 
    ? vaultTotalAssets - totalDeposited 
    : 0n;
  
  const yieldPercentage = totalDeposited > 0n
    ? (Number(totalYield * 10000n) / Number(totalDeposited)).toFixed(4)
    : "0.0000";

  // Display current state
  console.log("📈 Current State:");
  console.log("─".repeat(60));
  console.log(`   Strategy Balance:     ${formatUnits(strategyBalance, 18)} cUSD`);
  console.log(`   Vault Reserve:        ${formatUnits(vaultReserve, 18)} cUSD`);
  console.log(`   Vault Total Assets:    ${formatUnits(vaultTotalAssets, 18)} cUSD`);
  console.log(`   Total Deposited:      ${formatUnits(totalDeposited, 18)} cUSD`);
  console.log(`   Total Yield Earned:   ${formatUnits(totalYield, 18)} cUSD`);
  console.log(`   Yield Percentage:     ${yieldPercentage}%`);
  console.log(`   Current APY:          ${apy}%`);

  // User-specific tracking
  if (userAddresses.length > 0) {
    console.log("\n👤 User Earnings:");
    console.log("─".repeat(60));
    const userEarnings: Record<string, string> = {};

    for (const userAddress of userAddresses) {
      try {
        const earnings = await publicClient.readContract({
          address: DEPLOYED_CONTRACTS.vault,
          abi: vaultArtifact.abi,
          functionName: "getEarnings",
          args: [userAddress],
        });

        const balance = await publicClient.readContract({
          address: DEPLOYED_CONTRACTS.vault,
          abi: vaultArtifact.abi,
          functionName: "balanceOf",
          args: [userAddress],
        });

        const shares = await publicClient.readContract({
          address: DEPLOYED_CONTRACTS.vault,
          abi: vaultArtifact.abi,
          functionName: "shares",
          args: [userAddress],
        });

        const userData = await publicClient.readContract({
          address: DEPLOYED_CONTRACTS.vault,
          abi: vaultArtifact.abi,
          functionName: "userData",
          args: [userAddress],
        });

        userEarnings[userAddress] = formatUnits(earnings, 18);

        console.log(`\n   ${userAddress}:`);
        console.log(`      Balance:        ${formatUnits(balance, 18)} cUSD`);
        console.log(`      Shares:         ${shares.toString()}`);
        console.log(`      Earnings:       ${formatUnits(earnings, 18)} cUSD`);
        console.log(`      Total Deposited: ${formatUnits((userData as any)[0], 18)} cUSD`);
        console.log(`      Total Withdrawn: ${formatUnits((userData as any)[1], 18)} cUSD`);
      } catch (error) {
        console.error(`   ⚠️  Error fetching data for ${userAddress}:`, error);
      }
    }
  }

  // Historical comparison
  const snapshots = loadSnapshots();
  if (snapshots.length > 0) {
    const lastSnapshot = snapshots[snapshots.length - 1];
    const lastStrategyBalance = BigInt(lastSnapshot.strategyBalance);
    const lastTotalAssets = BigInt(lastSnapshot.vaultTotalAssets);
    const timeDiff = Date.now() / 1000 - lastSnapshot.timestamp;

    console.log("\n📊 Historical Comparison:");
    console.log("─".repeat(60));
    console.log(`   Last Snapshot:       ${lastSnapshot.date}`);
    console.log(`   Time Since:          ${Math.floor(timeDiff / 3600)} hours ${Math.floor((timeDiff % 3600) / 60)} minutes`);

    if (strategyBalance > lastStrategyBalance) {
      const yieldIncrease = strategyBalance - lastStrategyBalance;
      const hourlyYield = timeDiff > 0 
        ? (Number(yieldIncrease) / Number(timeDiff)) * 3600 
        : 0;
      console.log(`   Strategy Growth:     +${formatUnits(yieldIncrease, 18)} cUSD`);
      console.log(`   Hourly Yield Rate:   ~${formatUnits(BigInt(Math.floor(hourlyYield)), 18)} cUSD/hour`);
    } else {
      console.log(`   Strategy Growth:     No change (or decrease - check for withdrawals)`);
    }

    if (vaultTotalAssets > lastTotalAssets) {
      const totalIncrease = vaultTotalAssets - lastTotalAssets;
      console.log(`   Total Assets Growth: +${formatUnits(totalIncrease, 18)} cUSD`);
    }
  }

  // Create and save snapshot
  const snapshot: YieldSnapshot = {
    timestamp: Math.floor(Date.now() / 1000),
    date: new Date().toISOString(),
    strategyBalance: strategyBalance.toString(),
    vaultTotalAssets: vaultTotalAssets.toString(),
    vaultReserve: vaultReserve.toString(),
    totalDeposited: totalDeposited.toString(),
    totalYield: totalYield.toString(),
    yieldPercentage,
    apy,
    ...(userAddresses.length > 0 && { userEarnings }),
  };

  saveSnapshot(snapshot);

  // Summary
  console.log("\n✅ Yield Tracking Complete!");
  console.log("\n💡 Tips:");
  console.log("   - Run this script periodically to track yield accumulation");
  console.log("   - The strategy balance (aToken) increases automatically as Aave pays interest");
  console.log("   - Compare snapshots to see yield growth over time");
  console.log("   - Add user addresses as arguments to track specific users:");
  console.log(`     npx hardhat run scripts/track-yield.ts --network celoMainnet -- 0x...`);

  console.log("\n🔗 View on Celoscan:");
  console.log(`   Vault:    https://celoscan.io/address/${DEPLOYED_CONTRACTS.vault}`);
  console.log(`   Strategy: https://celoscan.io/address/${DEPLOYED_CONTRACTS.strategy}`);
}

main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exitCode = 1;
});
