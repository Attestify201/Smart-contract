import "dotenv/config";
import { network } from "hardhat";

// Contract addresses from deployment
const CONTRACTS = {
  strategy: "0x1ed36feb312b9d464d95fc1bab4b286ddc793341",
  vaultImplementation: "0xbe70318eb8772d265642a2ab6fee32cd250ec844",
  vaultProxy: "0x16a0ff8d36d9d660de8fd5257cff78adf11b8306",
};

// Constructor arguments for Strategy
const STRATEGY_ARGS = [
  "0x765DE816845861e75A25fCA122bb6898B8B1282a", // asset (cUSD)
  "0xBba98352628B0B0c4b40583F593fFCb630935a45", // aToken (acUSD)
  "0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5", // addressesProvider
];

async function main() {
  console.log("🔍 Starting contract verification on Sourcify...\n");
  console.log("Network: Celo Mainnet (42220)\n");

  // Import hardhat to get the run function
  const hre = await import("hardhat");

  // Verify Strategy
  console.log("1️⃣ Verifying AaveV3Strategy...");
  try {
    await hre.default.run("verify:verify", {
      address: CONTRACTS.strategy,
      constructorArguments: STRATEGY_ARGS,
      contract: "contracts/AaveV3Strategy.sol:AaveV3Strategy",
    });
    console.log("✅ AaveV3Strategy verified successfully!\n");
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    if (errorMsg.includes("Already Verified") || errorMsg.includes("already verified")) {
      console.log("✅ AaveV3Strategy already verified!\n");
    } else {
      console.error("❌ Error verifying AaveV3Strategy:");
      console.error(errorMsg);
      console.log("");
    }
  }

  // Verify Vault Implementation
  console.log("2️⃣ Verifying AttestifyVault implementation...");
  try {
    await hre.default.run("verify:verify", {
      address: CONTRACTS.vaultImplementation,
      constructorArguments: [], // Implementation has no constructor args (upgradeable)
      contract: "contracts/AttestifyVault.sol:AttestifyVault",
    });
    console.log("✅ AttestifyVault implementation verified successfully!\n");
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    if (errorMsg.includes("Already Verified") || errorMsg.includes("already verified")) {
      console.log("✅ AttestifyVault implementation already verified!\n");
    } else {
      console.error("❌ Error verifying AttestifyVault:");
      console.error(errorMsg);
      console.log("");
    }
  }

  // Note: Proxy contracts typically don't need verification as they're standard implementations
  console.log("📝 Note: Proxy contract verification skipped (standard ERC1967 implementation)");

  console.log("\n🎉 Verification process complete!");
  console.log("\n📋 View verified contracts at:");
  console.log(`   Strategy: https://sourcify.dev/#/contracts/full_match/42220/${CONTRACTS.strategy}`);
  console.log(`   Vault: https://sourcify.dev/#/contracts/full_match/42220/${CONTRACTS.vaultImplementation}`);
  console.log(`\n   Or check: https://repo.sourcify.dev/contracts/full_match/42220/`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
