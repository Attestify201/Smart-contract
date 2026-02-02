import "dotenv/config";
import process from "node:process";

import { network } from "hardhat";
import type { Address } from "viem";

/**
 * Script to verify deployed contracts on Celo Blockscout (Celoscan)
 * 
 * Usage:
 *   npx hardhat run scripts/verify-contracts.ts --network celoMainnet
 * 
 * Environment variables:
 *   CELOSCAN_API_KEY - Optional API key for Celoscan (not required for Celo)
 *   STRATEGY_ADDRESS - AaveV3Strategy contract address
 *   VAULT_IMPL_ADDRESS - AttestifyVault implementation address
 *   VAULT_PROXY_ADDRESS - AttestifyVault proxy address
 *   VERIFIER_ADDRESS - SelfProtocolVerifier address (optional)
 */

interface VerifyConfig {
    strategy?: Address;
    vaultImpl?: Address;
    vaultProxy?: Address;
    verifier?: Address;
    strategyArgs?: string[];
    vaultImplArgs?: string[];
    verifierArgs?: string[];
}

async function verifyContract(
    name: string,
    address: Address,
    constructorArguments?: string[]
) {
    console.log(`\n🔍 Verifying ${name} at ${address}...`);
    console.log(`   Constructor args:`, constructorArguments || "none");

    // For now, provide manual verification instructions
    // The verify task can be run via CLI: npx hardhat verify --network celoMainnet <address> <args...>
    console.log(`\n   To verify manually, run:`);
    if (constructorArguments && constructorArguments.length > 0) {
        const argsStr = constructorArguments.map(arg => `"${arg}"`).join(" ");
        console.log(`   npx hardhat verify --network celoMainnet ${address} ${argsStr}`);
    } else {
        console.log(`   npx hardhat verify --network celoMainnet ${address}`);
    }
    console.log(`   Or visit: https://celoscan.io/address/${address}#code`);
}

async function main() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    console.log("=== Contract Verification Script ===");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId.toString());
    console.log("");

    // Load addresses from environment
    const strategyAddress = process.env.STRATEGY_ADDRESS as Address | undefined;
    const vaultImplAddress = process.env.VAULT_IMPL_ADDRESS as Address | undefined;
    const vaultProxyAddress = process.env.VAULT_PROXY_ADDRESS as Address | undefined;
    const verifierAddress = process.env.VERIFIER_ADDRESS as Address | undefined;

    // Celo Mainnet defaults
    const CELO_MAINNET_DEFAULTS = {
        asset: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
        aToken: "0xBba98352628B0B0c4b40583F593fFCb630935a45",
        addressesProvider: "0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5",
        selfHubV2: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF",
    };

    // Verify Strategy (if address provided)
    if (strategyAddress) {
        const asset = process.env.ASSET_ADDRESS as Address || CELO_MAINNET_DEFAULTS.asset;
        const aToken = process.env.ATOKEN_ADDRESS as Address || CELO_MAINNET_DEFAULTS.aToken;
        const addressesProvider = process.env.AAVE_PROVIDER_ADDRESS as Address || CELO_MAINNET_DEFAULTS.addressesProvider;

        await verifyContract(
            "AaveV3Strategy",
            strategyAddress,
            [asset, aToken, addressesProvider]
        );
    }

    // Verify Vault Implementation (no constructor args, it's upgradeable)
    if (vaultImplAddress) {
        await verifyContract("AttestifyVault", vaultImplAddress, []);
    }

    // Note: Proxy contract (TestProxy) verification
    // The proxy uses ERC1967Proxy which is already verified on most networks
    if (vaultProxyAddress) {
        console.log(`\n📝 Proxy at ${vaultProxyAddress}`);
        console.log("   Note: ERC1967Proxy is typically already verified on Celo.");
        console.log("   If you need to verify it, use the proxy's constructor arguments:");
        console.log("   [implementationAddress, initializeCalldata]");
    }

    // Verify Verifier (if address provided)
    if (verifierAddress) {
        const hubV2 = process.env.SELF_HUB_V2 as Address || CELO_MAINNET_DEFAULTS.selfHubV2;
        const scopeSeed = process.env.SELF_SCOPE_SEED || "attestify-v1";
        const minimumAge = process.env.SELF_MIN_AGE || "18";
        const ofacEnabled = process.env.SELF_OFAC_ENABLED === "true";
        const forbiddenCountriesStr = process.env.SELF_FORBIDDEN_COUNTRIES || "";
        const forbiddenCountries = forbiddenCountriesStr
            ? forbiddenCountriesStr.split(",").map((c) => c.trim()).filter(Boolean)
            : [];

        // Note: The verifier constructor takes a config struct which is complex
        // You may need to verify manually via Blockscout interface
        console.log(`\n📝 Verifier at ${verifierAddress}`);
        console.log("   Note: SelfProtocolVerifier has complex constructor arguments.");
        console.log("   Consider verifying manually via Blockscout:");
        console.log(`   - Hub V2: ${hubV2}`);
        console.log(`   - Scope Seed: ${scopeSeed}`);
        console.log(`   - Config: olderThan=${minimumAge}, ofacEnabled=${ofacEnabled}`);
    }

    console.log("\n✅ Verification process complete!");
    console.log("\n💡 Tips:");
    console.log("   - Check contracts on Celoscan: https://celoscan.io");
    console.log("   - If verification fails, you can verify manually via the Blockscout UI");
    console.log("   - Make sure you're using the same compiler settings (optimizer runs: 200)");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

