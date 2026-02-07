import "dotenv/config";
import process from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

/**
 * Verify deployed contracts on Sourcify (Celo Mainnet).
 *
 * Addresses are read from:
 * 1. deployment-addresses.json (created by deploy-vault.ts)
 * 2. Or env vars: VAULT_ADDRESS, STRATEGY_ADDRESS, STRATEGY_CONSTRUCTOR_ARGS (JSON array)
 * 3. Or CLI args: --vault 0x... --strategy 0x...
 */
async function main() {
  const chainId = 42220;

  // Resolve addresses
  let vaultAddress: string;
  let strategyAddress: string;
  let strategyConstructorArgs: string[];

  const deploymentPath = join(process.cwd(), "deployment-addresses.json");
  if (existsSync(deploymentPath)) {
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
    vaultAddress = deployment.vault;
    strategyAddress = deployment.strategy;
    strategyConstructorArgs = deployment.strategyConstructorArgs ?? [];
    console.log("📂 Using addresses from deployment-addresses.json\n");
  } else {
    const vaultArg = process.argv.find((a) => a.startsWith("--vault="))?.split("=")[1];
    const strategyArg = process.argv.find((a) => a.startsWith("--strategy="))?.split("=")[1];
    vaultAddress = process.env.VAULT_ADDRESS ?? vaultArg ?? "";
    strategyAddress = process.env.STRATEGY_ADDRESS ?? strategyArg ?? "";

    if (process.env.STRATEGY_CONSTRUCTOR_ARGS) {
      strategyConstructorArgs = JSON.parse(process.env.STRATEGY_CONSTRUCTOR_ARGS);
    } else if (!vaultAddress || !strategyAddress) {
      throw new Error(
        "No deployment-addresses.json found. Provide addresses via:\n" +
          "  - Run deploy-vault.ts first (creates deployment-addresses.json)\n" +
          "  - Env: VAULT_ADDRESS, STRATEGY_ADDRESS, STRATEGY_CONSTRUCTOR_ARGS\n" +
          "  - CLI: --vault=0x... --strategy=0x..."
      );
    } else {
      // Celo mainnet defaults for strategy constructor
      strategyConstructorArgs = [
        "0x765DE816845861e75A25fCA122bb6898B8B1282a", // asset (cUSD)
        "0xBba98352628B0B0c4b40583F593fFCb630935a45", // aToken (acUSD)
        "0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5", // addressesProvider
        vaultAddress, // vault
      ];
    }
  }

  console.log("🔍 Verifying contracts on Sourcify (Celo Mainnet - 42220)\n");

  const hre = await import("hardhat");

  // Verify AaveV3Strategy
  console.log("1️⃣ Verifying AaveV3Strategy...");
  try {
    await verifyContract(
      {
        address: strategyAddress,
        constructorArgs: strategyConstructorArgs,
        contract: "contracts/AaveV3Strategy.sol:AaveV3Strategy",
        provider: "sourcify",
      },
      hre.default
    );
    console.log("✅ AaveV3Strategy verified!\n");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Already Verified") || msg.includes("already verified") || msg.includes("already verified")) {
      console.log("✅ AaveV3Strategy already verified!\n");
    } else {
      console.error("❌ AaveV3Strategy verification failed:", msg, "\n");
    }
  }

  // Verify AttestifyVault (implementation, no constructor args)
  console.log("2️⃣ Verifying AttestifyVault...");
  try {
    await verifyContract(
      {
        address: vaultAddress,
        constructorArgs: [],
        contract: "contracts/AttestifyVault.sol:AttestifyVault",
        provider: "sourcify",
      },
      hre.default
    );
    console.log("✅ AttestifyVault verified!\n");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log("✅ AttestifyVault already verified!\n");
    } else {
      console.error("❌ AttestifyVault verification failed:", msg, "\n");
    }
  }

  console.log("🎉 Verification complete!");
  console.log("\n📋 View verified contracts:");
  console.log(`   Strategy: https://sourcify.dev/#/contracts/full_match/${chainId}/${strategyAddress}`);
  console.log(`   Vault: https://sourcify.dev/#/contracts/full_match/${chainId}/${vaultAddress}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
