import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Contract addresses from deployment
const CONTRACTS = {
  strategy: "0x1ed36feb312b9d464d95fc1bab4b286ddc793341",
  vaultImplementation: "0xbe70318eb8772d265642a2ab6fee32cd250ec844",
  vaultProxy: "0x16a0ff8d36d9d660de8fd5257cff78adf11b8306",
};

const CHAIN_ID = 42220; // Celo Mainnet
const SOURCIFY_API = "https://sourcify.dev/server";

interface ContractFiles {
  [key: string]: {
    content: string;
  };
}

async function verifyContract(
  address: string,
  contractName: string,
  files: ContractFiles
) {
  console.log(`\n🔍 Verifying ${contractName} at ${address}...`);

  // Sourcify expects files in a specific format
  const requestBody = {
    address,
    chain: CHAIN_ID.toString(),
    files: files,
  };

  try {
    const response = await fetch(`${SOURCIFY_API}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ HTTP Error: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();

    if (result.status === "perfect" || result.status === "partial") {
      console.log(`✅ ${contractName} verified successfully!`);
      console.log(`   Status: ${result.status}`);
      console.log(`   View at: https://sourcify.dev/#/contracts/${result.status}/${CHAIN_ID}/${address}`);
      return true;
    } else if (result.error) {
      console.log(`❌ ${contractName} verification failed`);
      console.log(`   Error: ${result.error}`);
      if (result.message) {
        console.log(`   Message: ${result.message}`);
      }
      return false;
    } else {
      console.log(`❌ ${contractName} verification failed`);
      console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ Error verifying ${contractName}:`, error.message || error);
    return false;
  }
}

function getContractFiles(contractName: string): { files: ContractFiles; metadata?: any } {
  const files: ContractFiles = {};

  // Read main contract
  const contractPath = join(__dirname, "../contracts", `${contractName}.sol`);
  try {
    files[`contracts/${contractName}.sol`] = {
      content: readFileSync(contractPath, "utf-8"),
    };
  } catch (error) {
    console.error(`Error reading ${contractName}.sol:`, error);
  }

  // Read dependencies
  const dependencies: string[] = [];

  if (contractName === "AaveV3Strategy") {
    // AaveV3Strategy doesn't directly import IAave, but let's include it if needed
  } else if (contractName === "AttestifyVault") {
    dependencies.push("IAave");
  }

  // Read dependency files
  for (const dep of dependencies) {
    const depPath = join(__dirname, "../contracts", `${dep}.sol`);
    try {
      files[`contracts/${dep}.sol`] = {
        content: readFileSync(depPath, "utf-8"),
      };
    } catch (error) {
      console.warn(`Warning: Could not read ${dep}.sol`);
    }
  }

  // Try to read metadata.json from artifacts
  let metadata;
  try {
    const metadataPath = join(__dirname, "../artifacts/contracts", `${contractName}.sol`, `${contractName}.json`);
    const artifact = JSON.parse(readFileSync(metadataPath, "utf-8"));
    if (artifact.metadata) {
      metadata = JSON.parse(artifact.metadata);
      files["metadata.json"] = {
        content: artifact.metadata,
      };
    }
  } catch (error) {
    console.warn(`Warning: Could not read metadata for ${contractName}`);
  }

  return { files, metadata };
}

async function main() {
  console.log("🚀 Starting Sourcify verification for Celo Mainnet contracts...\n");

  const results = {
    strategy: false,
    vaultImplementation: false,
    vaultProxy: false,
  };

  // Verify Strategy
  const strategyData = getContractFiles("AaveV3Strategy");
  results.strategy = await verifyContract(
    CONTRACTS.strategy,
    "AaveV3Strategy",
    strategyData.files
  );

  // Verify Vault Implementation
  const vaultData = getContractFiles("AttestifyVault");
  results.vaultImplementation = await verifyContract(
    CONTRACTS.vaultImplementation,
    "AttestifyVault",
    vaultData.files
  );

  // Note: Proxy contracts (TestProxy) are typically not verified through Sourcify
  // as they're standard proxy implementations
  console.log("\n📝 Note: Proxy contracts are typically not verified separately.");
  console.log("   The proxy uses a standard ERC1967 implementation.");

  console.log("\n📊 Verification Summary:");
  console.log(`   Strategy: ${results.strategy ? "✅ Verified" : "❌ Failed"}`);
  console.log(`   Vault Implementation: ${results.vaultImplementation ? "✅ Verified" : "❌ Failed"}`);

  if (results.strategy && results.vaultImplementation) {
    console.log("\n🎉 All contracts verified successfully!");
  } else {
    console.log("\n⚠️  Some contracts failed verification. Check the errors above.");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
