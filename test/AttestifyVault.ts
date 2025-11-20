import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeFunctionData } from "viem";

describe("AttestifyVault", async () => {
  const { viem } = await network.connect();
  const wallets = await viem.getWalletClients();
  const [deployer, alice, bob] = wallets;
  const ONE = 10n ** 18n;

  async function deployFixture() {
    const asset = await viem.deployContract("MockERC20", ["Mock USD", "MUSD"]);
    const verifier = await viem.deployContract("MockVerifier");
    const strategy = await viem.deployContract("MockStrategy", [asset.address]);
    const vaultImpl = await viem.deployContract("AttestifyVault");
    const maxUser = 1_000_000n * ONE;
    const maxTotal = 10_000_000n * ONE;

    const initCallData = encodeFunctionData({
      abi: vaultImpl.abi,
      functionName: "initialize",
      args: [asset.address, strategy.address, verifier.address, maxUser, maxTotal],
    });

    const proxy = await viem.deployContract("TestProxy", [
      vaultImpl.address,
      initCallData,
    ]);

    const vault = await viem.getContractAt("AttestifyVault", proxy.address);

    await strategy.write.setVault([vault.address], { account: deployer.account });

    const mintAmount = 100_000n * ONE;
    for (const wallet of [deployer, alice, bob]) {
      await asset.write.mint([wallet.account.address, mintAmount], {
        account: deployer.account,
      });
    }

    return { asset, verifier, strategy, vault };
  }

  async function verifyUsers(verifier: any, users: string[]) {
    for (const user of users) {
      await verifier.write.setVerified([user, true], {
        account: deployer.account,
      });
    }
  }

  it("blocks unverified deposits", async () => {
    const { asset, verifier, vault } = await deployFixture();
    const depositAmount = 100n * ONE;

    await asset.write.approve([vault.address, depositAmount], {
      account: alice.account,
    });

    await assert.rejects(
      vault.write.deposit([depositAmount], { account: alice.account }),
    );

    await verifyUsers(verifier, [alice.account.address]);

    await vault.write.deposit([depositAmount], { account: alice.account });
    const balance = await vault.read.balanceOf([alice.account.address]);
    assert.equal(balance, depositAmount);
  });

  it("protects share price against donation manipulation", async () => {
    const { asset, verifier, vault } = await deployFixture();
    await verifyUsers(verifier, [alice.account.address, bob.account.address]);

    const smallDeposit = 1n * ONE;
    const donation = 1_000n * ONE;
    const bobDeposit = 2_000n * ONE;

    await asset.write.approve([vault.address, smallDeposit], {
      account: alice.account,
    });
    await vault.write.deposit([smallDeposit], { account: alice.account });

    await asset.write.transfer([vault.address, donation], {
      account: deployer.account,
    });

    await asset.write.approve([vault.address, bobDeposit], {
      account: bob.account,
    });
    await vault.write.deposit([bobDeposit], { account: bob.account });

    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    const tolerance = 2n;
    assert.ok(bobBalance >= bobDeposit - tolerance);
  });

  it("enforces minimum assets out on withdrawals", async () => {
    const { asset, verifier, vault } = await deployFixture();
    await verifyUsers(verifier, [bob.account.address]);

    const depositAmount = 500n * ONE;

    await asset.write.approve([vault.address, depositAmount], {
      account: bob.account,
    });
    await vault.write.deposit([depositAmount], { account: bob.account });

    await assert.rejects(
      bob.writeContract({
        address: vault.address,
        abi: vault.abi,
        functionName: "withdraw",
        args: [depositAmount / 2n, depositAmount / 2n + 1n],
      }),
    );
  });

  it("allows withdrawing entire balance via withdrawAll", async () => {
    const { asset, verifier, vault } = await deployFixture();
    await verifyUsers(verifier, [alice.account.address]);

    const depositAmount = 800n * ONE;

    await asset.write.approve([vault.address, depositAmount], {
      account: alice.account,
    });
    await vault.write.deposit([depositAmount], { account: alice.account });

    await vault.write.withdrawAll({ account: alice.account });

    const shareBalance = await vault.read.shares([alice.account.address]);
    const assetBalance = await vault.read.balanceOf([alice.account.address]);

    assert.equal(shareBalance, 0n);
    assert.equal(assetBalance, 0n);
  });

  it("tops up reserves when they fall below the target ratio", async () => {
    const { asset, verifier, strategy, vault } = await deployFixture();
    await verifyUsers(verifier, [alice.account.address]);

    const depositAmount = 1_000n * ONE;

    await asset.write.approve([vault.address, depositAmount], {
      account: alice.account,
    });
    await vault.write.deposit([depositAmount], { account: alice.account });

    const withdrawAmount = 200n * ONE;

    await vault.write.withdraw([withdrawAmount], { account: alice.account });

    const reserveBalance = await asset.read.balanceOf([vault.address]);
    const strategyBalance = await strategy.read.totalAssets();
    const totalAssets = await vault.read.totalAssets();
    const targetReserve = (totalAssets * 10n) / 100n;

    assert.equal(totalAssets, depositAmount - withdrawAmount);
    assert.ok(reserveBalance >= targetReserve);
    assert.equal(strategyBalance, totalAssets - reserveBalance);
  });
});

