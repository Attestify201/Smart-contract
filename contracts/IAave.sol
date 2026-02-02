// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IVaultYieldStrategy
 * @notice Interface for vault yield strategies
 * @dev FIX H-02: Explicit interface definition to prevent ABI mismatches
 * @dev All yield strategies must implement this interface for vault compatibility
 */
interface IVaultYieldStrategy {
    /**
     * @notice Deposit assets into the strategy
     * @param amount Amount of assets to deposit
     * @return Amount actually deposited
     * @dev Must return exact amount deposited for vault accounting
     */
    function deposit(uint256 amount) external returns (uint256);

    /**
     * @notice Withdraw assets from the strategy
     * @param amount Amount of assets to withdraw
     * @return Amount actually withdrawn
     * @dev May return less than requested if insufficient funds available
     */
    function withdraw(uint256 amount) external returns (uint256);

    /**
     * @notice Get total assets managed by the strategy
     * @return Total assets in strategy (including accrued yield)
     * @dev Used by vault for total asset calculation and share pricing
     */
    function totalAssets() external view returns (uint256);
}

/**
 * @title ISelfVerifier
 * @notice Interface for identity verification contract
 * @dev Handles Self Protocol integration for user verification
 */
interface ISelfVerifier {
    /**
     * @notice Check if a user is verified
     * @param user Address to check
     * @return True if user is verified, false otherwise
     */
    function isVerified(address user) external view returns (bool);
}
