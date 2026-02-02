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
 * @dev AUDIT FIXES IMPLEMENTED:
 *      - C-01: Fixed uninitialized vault by making it immutable and required in constructor
 *      - M-02: Added return value checking for Aave supply operation
 *      - I-01: Standardized all error handling with custom errors
 *      - I-02: Added comprehensive NatSpec documentation
 */
contract AaveV3Strategy is Ownable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public immutable asset; // cUSD token
    IERC20 public immutable aToken; // acUSD token
    IPool public immutable aavePool;
    IPoolAddressesProvider public immutable addressesProvider;
    
    // FIX C-01: Made vault immutable to prevent uninitialized state
    // This ensures vault is always set at deployment and cannot be changed
    address public immutable vault;

    /* ========== EVENTS ========== */

    event Deposited(uint256 amount, uint256 timestamp);
    event Withdrawn(uint256 amount, uint256 timestamp);

    /* ========== ERRORS ========== */

    error OnlyVault();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error SupplyMismatch(uint256 expected, uint256 actual); // FIX M-02: Added for supply validation

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initialize Aave strategy
     * @param _asset Underlying asset (cUSD)
     * @param _aToken Aave interest-bearing token (acUSD)
     * @param _addressesProvider Aave PoolAddressesProvider
     * @param _vault Vault contract address (REQUIRED - cannot be zero)
     * @dev FIX C-01: Vault is now required in constructor and immutable
     */
    constructor(
        address _asset,
        address _aToken,
        address _addressesProvider,
        address _vault
    ) Ownable(msg.sender) {
        // FIX C-01: Added vault to zero address check
        if (
            _asset == address(0) ||
            _aToken == address(0) ||
            _addressesProvider == address(0) ||
            _vault == address(0)
        ) {
            revert ZeroAddress();
        }

        asset = IERC20(_asset);
        aToken = IERC20(_aToken);
        addressesProvider = IPoolAddressesProvider(_addressesProvider);
        
        // FIX C-01: Initialize immutable vault (no longer settable)
        vault = _vault;

        // Get Pool address from provider (recommended by Aave)
        aavePool = IPool(addressesProvider.getPool());

        // Approve Aave pool to spend assets (one-time unlimited approval)
        asset.forceApprove(address(aavePool), type(uint256).max);
    }

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restricts function access to vault only
     * @dev FIX C-01: Now works correctly with immutable vault
     */
    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /* ========== VAULT FUNCTIONS ========== */

    /**
     * @notice Deposit assets to Aave
     * @param amount Amount to deposit
     * @return Amount actually deposited
     * @dev FIX M-02: Now validates that aTokens were received correctly
     */
    function deposit(uint256 amount) external onlyVault returns (uint256) {
        if (amount == 0) revert ZeroAmount();

        // Transfer from vault to this strategy
        asset.safeTransferFrom(msg.sender, address(this), amount);

        // FIX M-02: Check aToken balance before and after supply
        uint256 balanceBefore = aToken.balanceOf(address(this));
        
        // Supply to Aave (receives aTokens automatically)
        aavePool.supply(
            address(asset),
            amount,
            address(this),
            0 // No referral code
        );
        
        uint256 balanceAfter = aToken.balanceOf(address(this));
        uint256 received = balanceAfter - balanceBefore;

        // FIX M-02: Verify that we received expected aTokens
        // Note: In normal conditions, received should equal amount (1:1 ratio)
        // We allow received >= amount to handle edge cases with interest accrual
        if (received < amount) {
            revert SupplyMismatch(amount, received);
        }

        emit Deposited(amount, block.timestamp);
        return amount;
    }

    /**
     * @notice Withdraw assets from Aave
     * @param amount Amount to withdraw
     * @return Amount actually withdrawn
     * @dev Handles edge cases where available balance is less than requested
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
     * @dev Uses type(uint256).max to withdraw all available funds
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
     * @dev Returns aToken balance which represents claim on underlying asset plus interest
     */
    function totalAssets() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /**
     * @notice Get current supply APY from Aave
     * @return APY in basis points (e.g., 350 = 3.5%)
     * @dev TODO: Implement by querying Aave ProtocolDataProvider
     * @dev For now, returns estimated APY placeholder
     */
    function getCurrentAPY() external pure returns (uint256) {
        // TODO: Implement by querying Aave ProtocolDataProvider
        // For now, return estimated APY
        return 350; // 3.5%
    }

    /**
     * @notice Get simplified reserve data from Aave
     * @return liquidityIndex Current liquidity index
     * @return liquidityRate Current liquidity rate
     * @return variableBorrowRate Current variable borrow rate
     * @return stableBorrowRate Current stable borrow rate
     * @return lastUpdateTimestamp Last update timestamp
     * @dev Provides real-time Aave pool data for this asset
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
     * @notice Emergency withdraw all funds to owner
     * @dev Only callable by owner in case of emergency
     * @dev Withdraws all from Aave and transfers to owner
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
