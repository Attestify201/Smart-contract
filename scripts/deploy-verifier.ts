import "dotenv/config";
import process from "node:process";
import { readFileSync } from "fs";
import { join } from "path";
import { encodeAbiParameters, encodeFunctionData } from "viem";

import { network } from "hardhat";
import type { Address } from "viem";

// Celo Mainnet addresses (from query)
const CELO_MAINNET_ADDRESSES = {
  selfHubV2: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF" as Address,
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address,
} as const;

// Celo Alfajores Testnet addresses
const CELO_ALFAJORES_ADDRESSES = {
  selfHubV2: "0x18E05eAC6F31d03fb188FDc8e72FF354aB24EaB6" as Address,
  cUSD: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as Address,
} as const;

function getAddresses(chainId: bigint | number) {
  const id = typeof chainId === "bigint" ? chainId : BigInt(chainId);
  if (id === 42220n) {
    return CELO_MAINNET_ADDRESSES;
  } else if (id === 44787n) {
    return CELO_ALFAJORES_ADDRESSES;
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

async function deployVerifier() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  console.log("Deploying SelfProtocolVerifier...");
  console.log("Deployer:", deployer.account.address);
  console.log("Chain ID:", chainId.toString());

  const addresses = getAddresses(chainId);
  const hubV2 = process.env.SELF_HUB_V2 as Address | undefined || addresses.selfHubV2;
  const scopeSeed = process.env.SELF_SCOPE_SEED || "attestify-v1";
  
  // Verification config from env or use defaults
  const minimumAge = Number(process.env.SELF_MIN_AGE || "18");
  const ofacEnabled = process.env.SELF_OFAC_ENABLED === "true";
  
  // Parse forbidden countries from env (comma-separated) or use empty array
  const forbiddenCountriesStr = process.env.SELF_FORBIDDEN_COUNTRIES || "";
  const forbiddenCountries = forbiddenCountriesStr
    ? forbiddenCountriesStr.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  console.log("\nConfiguration:");
  console.log("- Self Hub V2:", hubV2);
  console.log("- Scope Seed:", scopeSeed);
  console.log("- Minimum Age:", minimumAge);
  console.log("- OFAC Enabled:", ofacEnabled);
  console.log("- Forbidden Countries:", forbiddenCountries.length > 0 ? forbiddenCountries.join(", ") : "None");

  // Build the verification config struct
  // Note: SelfUtils.UnformattedVerificationConfigV2 expects:
  // - olderThan: uint256
  // - forbiddenCountries: string[]
  // - ofacEnabled: bool
  const config = {
    olderThan: BigInt(minimumAge),
    forbiddenCountries: forbiddenCountries,
    ofacEnabled: ofacEnabled,
  };

  console.log("\nDeploying SelfProtocolVerifier contract...");
  console.log("Config:", JSON.stringify(config, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  
  // Format config as explicit tuple for ABI encoding
  const configTuple: [bigint, string[], boolean] = [
    config.olderThan,
    config.forbiddenCountries,
    config.ofacEnabled,
  ];
  
  // Read artifact directly
  const artifactPath = join(process.cwd(), "artifacts", "contracts", "SelfProtocolVerifier.sol", "SelfProtocolVerifier.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  
  // Encode constructor parameters
  const constructorAbi = artifact.abi.find((item: any) => item.type === "constructor");
  if (!constructorAbi) {
    throw new Error("Constructor not found in ABI");
  }
  
  const encodedArgs = encodeAbiParameters(
    constructorAbi.inputs,
    [hubV2, scopeSeed, configTuple]
  );
  
  // Deploy contract
  const hash = await deployer.sendTransaction({
    data: (artifact.bytecode as string) + encodedArgs.slice(2), // Remove 0x prefix from encoded args
  });
  
  console.log("Transaction hash:", hash);
  console.log("Waiting for deployment confirmation...");
  
  // Wait for deployment
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  // Get deployed address from receipt
  const verifierAddress = receipt.contractAddress;
  
  if (!verifierAddress) {
    throw new Error("Contract deployment failed - no contract address in receipt");
  }
  
  console.log("Contract deployed at:", verifierAddress);
  
  const verifier = await viem.getContractAt("SelfProtocolVerifier", verifierAddress);

  console.log("\n✅ SelfProtocolVerifier deployed!");
  console.log("Address:", verifier.address);

  console.log("\n=== For Vault Deployment ===");
  console.log("Set in your .env file:");
  console.log(`VERIFIER_ADDRESS=${verifier.address}`);

  return verifier.address;
}

deployVerifier().catch((error) => {
  console.error("Error deploying verifier:", error);
  process.exit(1);
});

