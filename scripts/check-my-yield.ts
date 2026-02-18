import "dotenv/config";
import { formatUnits } from "viem";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import type { Address } from "viem";

// Deployed contract addresses
const DEPLOYED_CONTRACTS = {
  vault: process.env.VAULT_ADDRESS || "0x16a0ff8d36d9d660de8fd5257cff78adf11b8306",
  strategy: process.env.STRATEGY_ADDRESS || "0x1ed36feb312b9d464d95fc1bab4b286ddc793341",
} as const;

// Your user address from the deposit test
const USER_ADDRESS = "0x7C13c31fb94FD9Ff6f8eF3F409471439D163125A" as Address;

async function main() {
  console.log("💰 Your Yield Earnings\n");
  console.log("=".repeat(60));

  const rpcUrl = process.env.CELO_MAINNET_RPC_URL || "https://forno.celo.org";
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });

  const hre = await import("hardhat");
  const vaultArtifact = await hre.artifacts.readArtifact("AttestifyVault");

  console.log(`\n👤 User: ${USER_ADDRESS}\n`);

  // Get user data
  const balance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "balanceOf",
    args: [USER_ADDRESS],
  });

  const shares = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "shares",
    args: [USER_ADDRESS],
  });

  const earnings = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "getEarnings",
    args: [USER_ADDRESS],
  });

  const userData = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "userData",
    args: [USER_ADDRESS],
  });

  const totalDeposited = (userData as any)[0];
  const totalWithdrawn = (userData as any)[1];

  // Get vault total assets for context
  const vaultTotalAssets = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.vault,
    abi: vaultArtifact.abi,
    functionName: "totalAssets",
  });

  const strategyBalance = await publicClient.readContract({
    address: DEPLOYED_CONTRACTS.strategy,
    abi: (await hre.artifacts.readArtifact("AaveV3Strategy")).abi,
    functionName: "totalAssets",
  });

  console.log("📊 Your Position:");
  console.log("─".repeat(60));
  console.log(`   Shares:            ${shares.toString()}`);
  console.log(`   Current Balance:   ${formatUnits(balance, 18)} cUSD`);
  console.log(`   Total Deposited:   ${formatUnits(totalDeposited, 18)} cUSD`);
  console.log(`   Total Withdrawn:   ${formatUnits(totalWithdrawn, 18)} cUSD`);
  console.log(`   Earnings:          ${formatUnits(earnings, 18)} cUSD`);

  const earningsPercent = totalDeposited > 0n
    ? (Number(earnings * 10000n) / Number(totalDeposited)).toFixed(4)
    : "0.0000";

  console.log(`   Earnings %:        ${earningsPercent}%`);

  console.log("\n📈 Vault Status:");
  console.log("─".repeat(60));
  console.log(`   Vault Total Assets: ${formatUnits(vaultTotalAssets, 18)} cUSD`);
  console.log(`   Strategy Balance:   ${formatUnits(strategyBalance, 18)} cUSD`);
  console.log(`   Your Share:         ${((Number(balance) / Number(vaultTotalAssets)) * 100).toFixed(2)}%`);

  console.log("\n✅ Your deposit is earning yield!");
  console.log(`   You've earned ${formatUnits(earnings, 18)} cUSD so far.`);
}

main().catch((error) => {
  console.error("\n💥 Error:", error);
  process.exitCode = 1;
});
