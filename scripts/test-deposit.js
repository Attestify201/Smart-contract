const { ethers } = require("hardhat");

/**
 * Check vault state before depositing.
 * Current AttestifyVault has no on-chain verifier — anyone can deposit (no human verification gate).
 */
async function main() {
  const [signer] = await ethers.getSigners();

  // Update to your vault address (or use deployment-addresses.json)
  const vaultAddress = process.env.VAULT_ADDRESS || "0x154e0a62d5d25bb405a6395ef8da0fdf33c6284a";
  const cusdAddress = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

  const vault = await ethers.getContractAt("AttestifyVault", vaultAddress);
  const cusd = await ethers.getContractAt("IERC20", cusdAddress);

  console.log("Checking vault state...");

  const owner = await vault.owner();
  console.log("Owner:", owner);
  console.log("Initialized:", owner !== ethers.constants.AddressZero);

  const paused = await vault.paused();
  console.log("Paused:", paused);

  const balance = await cusd.balanceOf(signer.address);
  console.log("Your cUSD balance:", ethers.utils.formatEther(balance));

  const allowance = await cusd.allowance(signer.address, vaultAddress);
  console.log("Vault allowance:", ethers.utils.formatEther(allowance));

  const maxUser = await vault.maxUserDeposit();
  const maxTotal = await vault.maxTotalDeposit();
  const totalAssets = await vault.totalAssets();
  const userBalance = await vault.balanceOf(signer.address);

  console.log("Max per user:", ethers.utils.formatEther(maxUser));
  console.log("Max total:", ethers.utils.formatEther(maxTotal));
  console.log("Total assets (TVL):", ethers.utils.formatEther(totalAssets));
  console.log("Your vault balance:", ethers.utils.formatEther(userBalance));

  console.log("\n=== Ready to deposit? ===");
  console.log("✅ Initialized:", owner !== ethers.constants.AddressZero);
  console.log("✅ Not paused:", !paused);
  console.log("✅ Has cUSD:", balance.gt(0));
  console.log("✅ Approved:", allowance.gt(0));
  console.log("(No on-chain human verification — vault does not gate deposits by verifier)");
}

main().catch(console.error);
