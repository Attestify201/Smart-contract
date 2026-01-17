// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";

/**
 * @title AaveV3Strategy
 * @notice Handles all Aave V3 integration logic
 * @dev Separates Aave-specific code from vault logic for clean architecture
 */
contract AaveV3Strategy is Ownable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public immutable asset; // cUSD token
    IERC20 public immutable aToken; // acUSD token
    IPool public immutable aavePool;
    IPoolAddressesProvider public immutable addressesProvider;

    address public vault; // Only vault can call deposit/withdraw (settable once)

    /* ========== EVENTS ========== */

    event Deposited(uint256 amount, uint256 timestamp);
    event Withdrawn(uint256 amount, uint256 timestamp);

    /* ========== ERRORS ========== */

    error OnlyVault();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error VaultAlreadySet();

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initialize Aave strategy
     * @param _asset Underlying asset (cUSD)
     * @param _aToken Aave interest-bearing token (acUSD)
     * @param _addressesProvider Aave PoolAddressesProvider
     * @param _vault Vault contract address (can be set in constructor or via setVault once)
     */
    constructor(
        address _asset,
        address _aToken,
        address _addressesProvider,
        address _vault
    ) Ownable(msg.sender) {
        if (
            _asset == address(0) ||
            _aToken == address(0) ||
            _addressesProvider == address(0)
        ) {
            revert ZeroAddress();
        }

        asset = IERC20(_asset);
        aToken = IERC20(_aToken);
        addressesProvider = IPoolAddressesProvider(_addressesProvider);

        // Vault can be set in constructor or later via setVault (but only once)
        if (_vault != address(0)) {
            vault = _vault;
        }

        // Get Pool address from provider (recommended by Aave)
        aavePool = IPool(addressesProvider.getPool());

        // Approve Aave pool to spend assets (one-time unlimited approval)
        asset.forceApprove(address(aavePool), type(uint256).max);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /* ========== VAULT FUNCTIONS ========== */

    /**
     * @notice Deposit assets to Aave
     * @param amount Amount to deposit
     * @return Amount actually deposited
     */
    function deposit(uint256 amount) external onlyVault returns (uint256) {
        if (amount == 0) revert ZeroAmount();

        // Transfer from vault to this strategy
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // Supply to Aave (receives aTokens automatically)
        // Note: Aave's supply() doesn't return a value, but we verify balance increase
        uint256 balanceBefore = aToken.balanceOf(address(this));
        aavePool.supply(
            address(asset),
            amount,
            address(this),
            0 // No referral code
        );
        uint256 balanceAfter = aToken.balanceOf(address(this));

        // Verify that we received aTokens (should be >= amount due to interest accrual)
        if (balanceAfter < balanceBefore + amount) {
            revert InsufficientBalance();
        }

        emit Deposited(amount, block.timestamp);
        return amount;
    }

    /**
     * @notice Withdraw assets from Aave
     * @param amount Amount to withdraw
     * @return Amount actually withdrawn
     */
    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        if (amount == 0) revert ZeroAmount();

        uint256 aTokenBalance = aToken.balanceOf(address(this));
        if (aTokenBalance == 0) return 0;

        // If requested amount exceeds available, withdraw max available
        uint256 withdrawAmount = amount > aTokenBalance
            ? aTokenBalance
            : amount;

        // Withdraw from Aave (burns aTokens, returns underlying)
        // Note: Aave's withdraw may return less than requested in edge cases
        uint256 withdrawn = aavePool.withdraw(
            address(asset),
            withdrawAmount,
            address(this)
        );

        // Transfer to vault (use actual withdrawn amount, not requested)
        if (withdrawn > 0) {
            asset.safeTransfer(vault, withdrawn);
        }

        emit Withdrawn(withdrawn, block.timestamp);
        return withdrawn;
    }

    /**
     * @notice Withdraw all assets from Aave
     * @return Amount withdrawn
     */
    function withdrawAll() external onlyVault returns (uint256) {
        uint256 balance = aToken.balanceOf(address(this));
        if (balance == 0) return 0;

        // Use type(uint256).max to withdraw all
        uint256 withdrawn = aavePool.withdraw(
            address(asset),
            type(uint256).max,
            address(this)
        );

        asset.safeTransfer(vault, withdrawn);

        emit Withdrawn(withdrawn, block.timestamp);
        return withdrawn;
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Get total balance in Aave (includes accrued interest)
     * @return Total balance in underlying asset
     */
    function totalAssets() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /**
     * @notice Get current supply APY from Aave
     * @return APY in basis points (e.g., 350 = 3.5%)
     * @dev This requires calling Aave's data provider for real-time APY
     */
    function getCurrentAPY() external pure returns (uint256) {
        // TODO: Implement by querying Aave ProtocolDataProvider
        // For now, return estimated APY
        return 350; // 3.5%
    }

    /**
     * @notice Get simplified reserve data from Aave
     */
    function getReserveData()
        external
        view
        returns (
            uint128 liquidityIndex,
            uint128 liquidityRate,
            uint128 variableBorrowRate,
            uint128 stableBorrowRate,
            uint40 lastUpdateTimestamp
        )
    {
        DataTypes.ReserveData memory data = aavePool.getReserveData(
            address(asset)
        );

        return (
            data.liquidityIndex,
            data.currentLiquidityRate,
            data.currentVariableBorrowRate,
            data.currentStableBorrowRate,
            data.lastUpdateTimestamp
        );
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Set vault address (only callable once by owner)
     * @param _vault Vault contract address
     * @dev Can only be called if vault is not already set
     */
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet();
        vault = _vault;
    }

    /**
     * @notice Emergency withdraw all funds to owner
     * @dev Only callable by owner in case of emergency
     */
    function emergencyWithdraw() external onlyOwner {
        // Withdraw all from Aave
        uint256 aaveBalance = aToken.balanceOf(address(this));
        if (aaveBalance > 0) {
            aavePool.withdraw(address(asset), type(uint256).max, address(this));
        }

        // Send all assets to owner
        uint256 balance = asset.balanceOf(address(this));
        if (balance > 0) {
            asset.safeTransfer(owner(), balance);
        }
    }
}
