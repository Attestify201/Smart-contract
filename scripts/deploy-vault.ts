import "dotenv/config";
import process from "node:process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { network } from "hardhat";
import { encodeFunctionData, parseUnits, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import type { Address } from "viem";

// Celo Mainnet addresses (queried from Aave)
const CELO_MAINNET_DEFAULTS = {
  asset: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address, // cUSD
  aToken: "0xBba98352628B0B0c4b40583F593fFCb630935a45" as Address, // acUSD
  addressesProvider: "0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5" as Address,
} as const;

// Celo Alfajores Testnet addresses
const CELO_ALFAJORES_DEFAULTS = {
  asset: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as Address, // cUSD
  aToken: "" as Address, // TODO: Query from Aave on Alfajores
  addressesProvider: "" as Address, // TODO: Get from Aave docs
} as const;

type DeployConfig = {
  asset: Address;
  aToken: Address;
  addressesProvider: Address;
  maxUserDeposit: bigint;
  maxTotalDeposit: bigint;
  assetDecimals: number;
  rebalancer?: Address;
};

function getAddress(name: string, defaultValue?: Address): Address {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Missing required env var ${name} and no default available`);
  }
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error(`Env var ${name} must be a 20-byte hex address`);
  }
  return value as Address;
}

function requireAddress(name: string): Address {
  return getAddress(name);
}

function getAmountEnv(name: string, decimals: number, fallback: string): bigint {
  const raw = process.env[name] ?? fallback;
  return parseUnits(raw, decimals);
}

async function loadConfig(chainId: bigint): Promise<DeployConfig> {
  const assetDecimals = Number(process.env.ASSET_DECIMALS ?? "18");

  // Get defaults based on chain
  // Convert to number for comparison to handle both bigint and number
  const chainIdNum = Number(chainId);
  const defaults = chainIdNum === 42220
    ? CELO_MAINNET_DEFAULTS
    : chainIdNum === 44787
      ? CELO_ALFAJORES_DEFAULTS
      : null;

  if (!defaults) {
    console.warn(`⚠️  Unknown chain (chainId: ${chainIdNum}), using env vars only (no defaults)`);
  }

  return {
    asset: getAddress("ASSET_ADDRESS", defaults?.asset),
    aToken: getAddress("ATOKEN_ADDRESS", defaults?.aToken),
    addressesProvider: getAddress("AAVE_PROVIDER_ADDRESS", defaults?.addressesProvider),
    maxUserDeposit: getAmountEnv("MAX_USER_DEPOSIT", assetDecimals, "1000"),
    maxTotalDeposit: getAmountEnv("MAX_TOTAL_DEPOSIT", assetDecimals, "10000"),
    assetDecimals,
    rebalancer: process.env.REBALANCER_ADDRESS as Address | undefined,
  };
}

// Determine chainId based on network name (before connecting)
// This avoids RPC calls that might timeout
const networkName = process.argv.find(arg => arg.includes("--network"))?.split("=")[1] ||
  process.argv[process.argv.indexOf("--network") + 1] ||
  "celoMainnet";

let chainId: bigint;
if (networkName === "celoMainnet" || networkName.includes("mainnet")) {
  chainId = 42220n;
} else if (networkName === "celoAlfajores" || networkName.includes("alfajores")) {
  chainId = 44787n;
} else {
  // Default to mainnet
  chainId = 42220n;
  console.log(`⚠️  Unknown network "${networkName}", defaulting to Celo Mainnet (42220)`);
}

console.log("Network:", networkName);
console.log("Using chainId:", chainId.toString());
const params = await loadConfig(chainId);

// Connect to network and create wallet client
const { viem } = await network.connect();
const publicClient = await viem.getPublicClient();

// Get private key from env
const privateKey = process.env.CELO_PRIVATE_KEY;
if (!privateKey) {
  throw new Error("CELO_PRIVATE_KEY not found in .env file");
}

// Create account and wallet client manually
const account = privateKeyToAccount(privateKey as `0x${string}`);
const deployer = createWalletClient({
  account,
  chain: celo,
  transport: http(process.env.CELO_MAINNET_RPC_URL || "https://forno.celo.org"),
});

console.log("Deploying with account:", account.address);
console.log("Chain id:", chainId.toString());
console.log("\nConfiguration:");
console.log("- Asset (cUSD):", params.asset);
console.log("- aToken (acUSD):", params.aToken);
console.log("- Aave Provider:", params.addressesProvider);
console.log("- Max User Deposit:", params.maxUserDeposit.toString());
console.log("- Max Total Deposit:", params.maxTotalDeposit.toString());
console.log("");

// Get contract artifacts from Hardhat
const hre = await import("hardhat");

const strategyArtifact = await hre.artifacts.readArtifact("AaveV3Strategy");
const vaultArtifact = await hre.artifacts.readArtifact("AttestifyVault");



console.log("Deploying AttestifyVault...");
const vaultHash = await deployer.deployContract({
  abi: vaultArtifact.abi,
  bytecode: vaultArtifact.bytecode as `0x${string}`,
  // No constructor args for upgradeable contract
  gas: 8000000n,
});
const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
const vaultAddress = vaultReceipt.contractAddress!;
console.log("Vault deployed at:", vaultAddress);

// Deploy AaveV3Strategy first, since initialize needs its address
console.log("Deploying AaveV3Strategy...");
const strategyHash = await deployer.deployContract({
  abi: strategyArtifact.abi,
  bytecode: strategyArtifact.bytecode as `0x${string}`,
  args: [params.asset, params.aToken, params.addressesProvider, vaultAddress],
  gas: 8000000n,
});
const strategyReceipt = await publicClient.waitForTransactionReceipt({ hash: strategyHash });
const strategyAddress = strategyReceipt.contractAddress!;
console.log("Strategy deployed at:", strategyAddress);

// Call initialize on the vault
console.log("Initializing AttestifyVault...");
await deployer.writeContract({
  address: vaultAddress,
  abi: vaultArtifact.abi,
  functionName: "initialize",
  args: [
    params.asset,
    strategyAddress,
    params.maxUserDeposit,
    params.maxTotalDeposit,
  ],
  gas: 2000000n,
});
console.log("Vault initialized.");


if (params.rebalancer && params.rebalancer !== account.address) {
  console.log("Setting custom rebalancer:", params.rebalancer);
  await deployer.writeContract({
    address: vaultAddress,
    abi: vaultArtifact.abi,
    functionName: "setRebalancer",
    args: [params.rebalancer],
    gas: 500000n,
  });
}

// Save deployment addresses for verification
const deploymentPath = join(process.cwd(), "deployment-addresses.json");
const deployment = {
  network: networkName,
  chainId: chainId.toString(),
  vault: vaultAddress,
  strategy: strategyAddress,
  strategyConstructorArgs: [
    params.asset,
    params.aToken,
    params.addressesProvider,
    vaultAddress,
  ],
};
writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
console.log("\nDeployment saved to:", deploymentPath);

console.log("\nDeployment complete:");
console.log("- Vault:", vaultAddress);
console.log("- Strategy:", strategyAddress);

console.log("\n📝 Next steps:");
console.log("1. Verify on Sourcify: npx hardhat run scripts/verify-contracts.ts --network celoMainnet");
console.log("2. Fund the vault with reserves if needed.");
console.log("3. Configure rebalancer/treasury roles and deposit limits as required.");