const { ethers } = require("hardhat");

async function main() {
    const [signer] = await ethers.getSigners();

    const vaultAddress = "0xbf277f1e43d825a481fe807ab145f812a34233e6";
    const cusdAddress = "0x765DE816845861e75A25fCA122bb6898B8B1282a";

    const vault = await ethers.getContractAt("AttestifyVault", vaultAddress);
    const cusd = await ethers.getContractAt("IERC20", cusdAddress);

    console.log("Checking vault state...");

    // Check if initialized
    const owner = await vault.owner();
    console.log("Owner:", owner);
    console.log("Initialized:", owner !== ethers.constants.AddressZero);

    // Check paused
    const paused = await vault.paused();
    console.log("Paused:", paused);

    // Check balance
    const balance = await cusd.balanceOf(signer.address);
    console.log("Your cUSD balance:", ethers.utils.formatEther(balance));

    // Check allowance
    const allowance = await cusd.allowance(signer.address, vaultAddress);
    console.log("Vault allowance:", ethers.utils.formatEther(allowance));

    // Check limits
    const maxUser = await vault.maxUserDeposit();
    const maxTotal = await vault.maxTotalDeposit();
    const totalDeposits = await vault.totalDeposits();
    const userDeposit = await vault.getUserDeposit(signer.address);

    console.log("Max per user:", ethers.utils.formatEther(maxUser));
    console.log("Max total:", ethers.utils.formatEther(maxTotal));
    console.log("Current total:", ethers.utils.formatEther(totalDeposits));
    console.log("Your deposits:", ethers.utils.formatEther(userDeposit));

    // Check verification
    const verifierAddress = await vault.verifier();
    const verifier = await ethers.getContractAt("SelfProtocolVerifier", verifierAddress);
    const isVerified = await verifier.isVerified(signer.address);
    console.log("Self Protocol verified:", isVerified);

    console.log("\n=== Ready to deposit? ===");
    console.log("✅ Initialized:", owner !== ethers.constants.AddressZero);
    console.log("✅ Not paused:", !paused);
    console.log("✅ Has cUSD:", balance.gt(0));
    console.log("✅ Approved:", allowance.gt(0));
    console.log("✅ Verified:", isVerified);
}

main().catch(console.error);