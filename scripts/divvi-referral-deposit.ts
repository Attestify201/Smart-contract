import "dotenv/config";

import { getReferralTag, submitReferral } from "@divvi/referral-sdk";
import { network } from "hardhat";
import { encodeFunctionData, parseUnits, type Address } from "viem";

const CONSUMER_ADDRESS = "0xfE5A802bD22905254B80F820C68893Eb31571a3d";

async function main() {
    const vaultAddress = process.env.VAULT_ADDRESS as Address | undefined;
    if (!vaultAddress) {
        throw new Error("Set VAULT_ADDRESS in env (vault proxy on mainnet)");
    }

    const depositAmount = process.env.DEPOSIT_AMOUNT ?? "1";
    const assetDecimals = Number(process.env.ASSET_DECIMALS ?? "18");

    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [sender] = await viem.getWalletClients();
    const chainId = await publicClient.getChainId();

    const vault = await viem.getContractAt("AttestifyVault", vaultAddress);

    const callData = encodeFunctionData({
        abi: vault.abi,
        functionName: "deposit",
        args: [parseUnits(depositAmount, assetDecimals)],
    });

    const referralTag = getReferralTag({
        user: sender.account.address,
        consumer: CONSUMER_ADDRESS,
    });

    const txHash = await sender.sendTransaction({
        to: vault.address,
        data: `${callData}${referralTag.slice(2)}` as `0x${string}`,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log("Deposit tx sent with Divvi tag:", receipt.transactionHash);

    try {
        await submitReferral({
            consumer: CONSUMER_ADDRESS,
            user: sender.account.address,
            transactionHash: txHash,
            chainId,
        });
        console.log("Referral submitted to Divvi");
    } catch (error) {
        console.warn("Referral submission failed (tx still succeeded):", error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

