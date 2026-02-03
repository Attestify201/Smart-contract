// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IAave.sol";

/**
 * @title AttestifyVault
 * @notice Main vault contract for yield generation with identity verification
 * @dev Non-upgradeable immutable vault, integrates with separate strategy contracts
 * @dev AUDIT FIXES IMPLEMENTED:
 *      - C-02: Fixed share calculation for first deposit
 *      - H-01: Implemented gas-bounded circuit breaker pattern
 *      - M-01: Added front-running protection for rebalancing
 *      - L-01: Changed to basis points (1000 = 10%) for precision
 *      - I-01: Standardized all error handling with custom errors
 *      - I-02: Added comprehensive NatSpec documentation
 *
 * Architecture:
 * - Vault: Holds user funds, manages shares
 * - Strategy: Deploys funds to yield sources (Aave)
 * - Verifier: Handles identity verification (Self Protocol)
 */
contract AttestifyVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES (DO NOT REORDER) ========== */

    // Core contracts
    IERC20 public asset; // cUSD token
    address public strategy; // Aave strategy contract
    address public verifier; // Self verifier contract

    // Vault accounting
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    // User data
    mapping(address => UserData) public userData;

    struct UserData {
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 lastActionTime;
    }

    // Configuration - FIX L-01: Use basis points for better precision
    uint256 public constant MIN_DEPOSIT = 1e18; // 1 cUSD
    uint256 public maxUserDeposit; // Per user limit
    uint256 public maxTotalDeposit; // Total TVL limit
    uint256 public constant RESERVE_RATIO_BPS = 1000; // 10% kept in vault (1000 basis points = 10%)
    uint256 public constant MIN_REBALANCE_INTERVAL = 1 hours; // FIX M-01: Minimum time between rebalances
    uint256 private constant VIRTUAL_SHARES = 1e3; // Virtual liquidity to harden share price
    uint256 private constant VIRTUAL_ASSETS = 1e3;

    // FIX H-01: Gas limit for strategy calls to prevent unbounded consumption
    uint256 private constant STRATEGY_GAS_LIMIT = 100000; // 100k gas for external calls

    // Admin
    address public treasury; // Reserved for future fee collection mechanism
    address public rebalancer; // Can be AI agent
    uint256 public lastRebalance;

    // Stats
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    /* ========== EVENTS ========== */

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(
        address indexed user,
        uint256 assets,
        uint256 shares,
        address indexed strategy,
        uint256 strategyBalance
    );
    event Rebalanced(
        uint256 strategyBalance,
        uint256 reserveBalance,
        uint256 timestamp
    );
    event StrategyUpdated(
        address indexed oldStrategy,
        address indexed newStrategy
    );
    event VerifierUpdated(
        address indexed oldVerifier,
        address indexed newVerifier
    );
    event LimitsUpdated(uint256 maxUser, uint256 maxTotal);
    // FIX H-01: Event for strategy failures
    event StrategyCallFailed(string reason);

    /* ========== ERRORS ========== */

    error NotVerified();
    error InvalidAmount();
    error ExceedsUserLimit();
    error ExceedsTVLLimit();
    error InsufficientShares();
    error InsufficientBalance();
    error ZeroAddress();
    error ExceedsBalance();
    error SlippageTooHigh();
    error StrategyDepositMismatch(uint256 expected, uint256 actual);
    error UnauthorizedRebalancer();
    error NotPaused();
    error RebalanceTooSoon(); // FIX M-01: Error for front-running protection

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initialize vault (immutable, cannot be changed)
     * @param _asset Underlying asset (cUSD)
     * @param _strategy Aave strategy contract
     * @param _verifier Self verifier contract (optional, can be zero)
     * @param _maxUserDeposit Max deposit per user
     * @param _maxTotalDeposit Max total TVL
     * @dev Non-upgradeable - contract code is permanent and cannot be changed
     */
    constructor(
        address _asset,
        address _strategy,
        address _verifier,
        uint256 _maxUserDeposit,
        uint256 _maxTotalDeposit
    ) Ownable(msg.sender) {
        if (_asset == address(0) || _strategy == address(0)) {
            revert ZeroAddress();
        }

        asset = IERC20(_asset);
        strategy = _strategy;
        verifier = _verifier;
        maxUserDeposit = _maxUserDeposit;
        maxTotalDeposit = _maxTotalDeposit;
        treasury = msg.sender;
        rebalancer = msg.sender;
    }

    /**
     * @notice Get contract version
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "1.1.0"; // Non-upgradeable immutable version
    }

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restrict access to verified users only
     * @dev Calls verifier contract to check user status
     */
    modifier onlyVerified() {
        // If no verifier is configured, skip verification (integration removed/optional)
        if (verifier != address(0)) {
            if (!ISelfVerifier(verifier).isVerified(msg.sender)) {
                revert NotVerified();
            }
        }
        _;
    }

    /* ========== DEPOSIT FUNCTIONS ========== */

    /**
     * @notice Deposit cUSD to earn yield
     * @param assets Amount of cUSD to deposit
     * @return sharesIssued Shares minted to user
     * @dev Requires user to be verified via Self Protocol
     * @dev Enforces minimum deposit and per-user/total limits
     */
    function deposit(
        uint256 assets
    )
        external
        nonReentrant
        whenNotPaused
        onlyVerified
        returns (uint256 sharesIssued)
    {
        // Validation
        if (assets < MIN_DEPOSIT) revert InvalidAmount();
        if (assets > maxUserDeposit) revert ExceedsUserLimit();
        if (totalAssets() + assets > maxTotalDeposit) revert ExceedsTVLLimit();

        // Calculate shares
        sharesIssued = _convertToShares(assets);

        // Update state
        shares[msg.sender] += sharesIssued;
        totalShares += sharesIssued;
        userData[msg.sender].totalDeposited += assets;
        userData[msg.sender].lastActionTime = block.timestamp;
        totalDeposited += assets;

        // Transfer assets from user
        asset.safeTransferFrom(msg.sender, address(this), assets);

        // Deploy to strategy (keeping reserve)
        _deployToStrategy(assets);

        emit Deposited(msg.sender, assets, sharesIssued);
    }

    /**
     * @notice Internal function to deploy assets to strategy
     * @param amount Amount to potentially deploy
     * @dev FIX L-01: Uses basis points for better precision (1000 = 10%)
     */
    function _deployToStrategy(uint256 amount) internal {
        uint256 reserveAmount = (amount * RESERVE_RATIO_BPS) / 10000;
        uint256 deployAmount = amount - reserveAmount;

        if (deployAmount > 0) {
            // Approve strategy
            asset.forceApprove(strategy, deployAmount);

            // Call strategy deposit
            uint256 deposited = IVaultYieldStrategy(strategy).deposit(
                deployAmount
            );
            if (deposited != deployAmount) {
                revert StrategyDepositMismatch(deployAmount, deposited);
            }
        }
    }

    /* ========== WITHDRAW FUNCTIONS ========== */

    /**
     * @notice Withdraw cUSD (principal + yield)
     * @param assets Requested assets to withdraw
     * @return sharesBurned Shares burned
     */
    function withdraw(uint256 assets) external returns (uint256 sharesBurned) {
        return withdraw(assets, assets);
    }

    /**
     * @notice Withdraw with slippage protection
     * @param assets Requested assets to withdraw
     * @param minAssetsOut Minimum acceptable assets after share conversion
     * @return sharesBurned Shares burned
     * @dev Allows users to protect against share price manipulation
     */
    function withdraw(
        uint256 assets,
        uint256 minAssetsOut
    ) public nonReentrant returns (uint256 sharesBurned) {
        return _processWithdraw(msg.sender, assets, minAssetsOut);
    }

    /**
     * @notice Withdraw all user's balance
     * @return sharesBurned Shares burned
     * @dev Convenience function to withdraw entire user balance
     */
    function withdrawAll() external returns (uint256 sharesBurned) {
        uint256 userAssets = balanceOf(msg.sender);
        return withdraw(userAssets, userAssets);
    }

    /**
     * @notice Internal function to withdraw from strategy
     * @param amount Amount to withdraw
     * @dev Reverts if strategy cannot provide requested amount
     */
    function _withdrawFromStrategy(uint256 amount) internal {
        uint256 received = IVaultYieldStrategy(strategy).withdraw(amount);
        if (received < amount) revert InsufficientBalance();
    }

    /**
     * @notice Process withdrawal logic
     * @param user User address
     * @param assets Amount to withdraw
     * @param minAssetsOut Minimum acceptable output
     * @return sharesBurned Shares burned
     * @dev Handles all withdrawal accounting and transfers
     */
    function _processWithdraw(
        address user,
        uint256 assets,
        uint256 minAssetsOut
    ) internal returns (uint256 sharesBurned) {
        if (assets == 0) revert InvalidAmount();

        uint256 maxWithdraw = balanceOf(user);
        if (assets > maxWithdraw) revert ExceedsBalance();

        sharesBurned = _convertToShares(assets);
        if (shares[user] < sharesBurned) revert InsufficientShares();

        uint256 assetsOut = _convertToAssets(sharesBurned);
        if (assetsOut < minAssetsOut) revert SlippageTooHigh();

        shares[user] -= sharesBurned;
        totalShares -= sharesBurned;

        userData[user].totalWithdrawn += assetsOut;
        userData[user].lastActionTime = block.timestamp;
        totalWithdrawn += assetsOut;

        uint256 reserveBalance = asset.balanceOf(address(this));

        if (reserveBalance < assetsOut) {
            uint256 shortfall = assetsOut - reserveBalance;
            _withdrawFromStrategy(shortfall);
        }

        asset.safeTransfer(user, assetsOut);

        _ensureReserveRatio();

        // FIX H-01: Get strategy balance with circuit breaker
        uint256 strategyBalance = _getStrategyBalanceSafe();

        emit Withdrawn(
            user,
            assetsOut,
            sharesBurned,
            strategy,
            strategyBalance
        );
    }

    /**
     * @notice Ensure reserve ratio is maintained
     * @dev FIX L-01: Uses basis points for precision (1000 = 10%)
     */
    function _ensureReserveRatio() internal {
        uint256 _totalAssets = totalAssets();
        if (_totalAssets == 0) return;

        uint256 targetReserve = (_totalAssets * RESERVE_RATIO_BPS) / 10000;
        uint256 currentReserve = asset.balanceOf(address(this));

        if (currentReserve < targetReserve) {
            uint256 shortfall = targetReserve - currentReserve;
            _withdrawFromStrategy(shortfall);
        }
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Get total assets under management
     * @return Total cUSD (reserve + strategy)
     * @dev FIX H-01: Uses gas-bounded circuit breaker pattern to prevent unbounded gas consumption
     * @dev If strategy call fails or exceeds gas limit, defaults to 0 (circuit breaker)
     */
    function totalAssets() public view returns (uint256) {
        uint256 reserveBalance = asset.balanceOf(address(this));
        uint256 strategyBalance = _getStrategyBalanceSafe();
        return reserveBalance + strategyBalance;
    }

    /**
     * @notice Safely get strategy balance with circuit breaker
     * @return Strategy balance or 0 if call fails
     * @dev FIX H-01: Implements gas-bounded circuit breaker pattern
     * @dev Limits gas to prevent malicious strategy from consuming unbounded gas
     */
    function _getStrategyBalanceSafe() internal view returns (uint256) {
        if (strategy == address(0)) return 0;

        // FIX H-01: Use try-catch with gas limit to prevent unbounded consumption
        // Circuit breaker: if strategy fails or exceeds gas, return 0
        try
            IVaultYieldStrategy(strategy).totalAssets{gas: STRATEGY_GAS_LIMIT}()
        returns (uint256 balance) {
            return balance;
        } catch {
            // Strategy call failed - circuit breaker activates
            // Return 0 for strategy balance, vault continues with reserve only
            return 0;
        }
    }

    /**
     * @notice Get user's balance in assets
     * @param user User address
     * @return Balance in cUSD (including earned yield)
     */
    function balanceOf(address user) public view returns (uint256) {
        return _convertToAssets(shares[user]);
    }

    /**
     * @notice Get user's earnings
     * @param user User address
     * @return Total earnings (current balance + withdrawn - deposited)
     */
    function getEarnings(address user) external view returns (uint256) {
        uint256 currentBalance = balanceOf(user);
        uint256 deposited = userData[user].totalDeposited;
        uint256 withdrawn = userData[user].totalWithdrawn;

        if (currentBalance + withdrawn > deposited) {
            return (currentBalance + withdrawn) - deposited;
        }
        return 0;
    }

    /**
     * @notice Convert assets to shares
     * @param assets Amount of assets
     * @return shares Amount of shares
     * @dev Uses virtual shares/assets to prevent rounding errors on first deposit
     * @dev FIX C-02: Consistent with _convertToAssets for first deposit
     */
    function _convertToShares(uint256 assets) internal view returns (uint256) {
        uint256 _totalAssets = totalAssets();

        // FIX C-02: Handle first deposit case - return assets directly for 1:1 ratio
        if (_totalAssets == 0 || totalShares == 0) {
            return assets;
        }

        uint256 adjustedAssets = _totalAssets + VIRTUAL_ASSETS;
        uint256 adjustedShares = totalShares + VIRTUAL_SHARES;

        return (assets * adjustedShares) / adjustedAssets;
    }

    /**
     * @notice Convert shares to assets
     * @param _shares Amount of shares
     * @return assets Amount of assets
     * @dev FIX C-02: Returns shares directly on first deposit (1:1 ratio)
     * @dev Uses virtual shares/assets to prevent rounding errors
     */
    function _convertToAssets(uint256 _shares) internal view returns (uint256) {
        if (_shares == 0) return 0;

        // FIX C-02: On first deposit, return shares directly (1:1 ratio)
        // This matches _convertToShares behavior for consistency
        if (totalShares == 0) return _shares;

        uint256 adjustedShares = totalShares + VIRTUAL_SHARES;
        uint256 adjustedAssets = totalAssets() + VIRTUAL_ASSETS;

        if (adjustedAssets == 0) return 0;

        return (_shares * adjustedAssets) / adjustedShares;
    }

    /* ========== REBALANCE ========== */

    /**
     * @notice Rebalance between strategy and reserve
     * @dev FIX M-01: Prevents front-running by enforcing minimum time between rebalances
     * @dev FIX L-01: Uses basis points for precision (1000 = 10%)
     * @dev Only owner or designated rebalancer can call
     */
    function rebalance() external {
        if (msg.sender != owner() && msg.sender != rebalancer) {
            revert UnauthorizedRebalancer();
        }

        // FIX M-01: Prevent front-running by enforcing minimum time between rebalances
        if (
            lastRebalance != 0 &&
            block.timestamp < lastRebalance + MIN_REBALANCE_INTERVAL
        ) {
            revert RebalanceTooSoon();
        }

        uint256 _totalAssets = totalAssets();
        uint256 targetReserve = (_totalAssets * RESERVE_RATIO_BPS) / 10000;
        uint256 currentReserve = asset.balanceOf(address(this));

        if (currentReserve < targetReserve) {
            // Need more in reserve
            uint256 needed = targetReserve - currentReserve;
            _withdrawFromStrategy(needed);
        } else if (currentReserve > targetReserve * 2) {
            // Too much in reserve (more than 2x target)
            uint256 excess = currentReserve - targetReserve;
            _deployToStrategy(excess);
        }
        // If slightly over target but not 2x, don't rebalance to prevent constant rebalancing

        lastRebalance = block.timestamp;

        // Get updated balances for event
        uint256 strategyBalance = _getStrategyBalanceSafe();

        emit Rebalanced(
            strategyBalance,
            asset.balanceOf(address(this)),
            block.timestamp
        );
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Set new strategy contract
     * @param _strategy New strategy address
     * @dev Only owner can update strategy
     */
    function setStrategy(address _strategy) external onlyOwner {
        if (_strategy == address(0)) revert ZeroAddress();
        address old = strategy;
        strategy = _strategy;
        emit StrategyUpdated(old, _strategy);
    }

    /**
     * @notice Set new verifier contract
     * @param _verifier New verifier address
     * @dev Only owner can update verifier
     */
    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert ZeroAddress();
        address old = verifier;
        verifier = _verifier;
        emit VerifierUpdated(old, _verifier);
    }

    /**
     * @notice Update deposit limits
     * @param _maxUser Max deposit per user
     * @param _maxTotal Max total TVL
     * @dev Only owner can update limits
     */
    function setLimits(uint256 _maxUser, uint256 _maxTotal) external onlyOwner {
        maxUserDeposit = _maxUser;
        maxTotalDeposit = _maxTotal;
        emit LimitsUpdated(_maxUser, _maxTotal);
    }

    /**
     * @notice Set rebalancer address
     * @param _rebalancer New rebalancer address (can be AI agent)
     * @dev Only owner can update rebalancer
     */
    function setRebalancer(address _rebalancer) external onlyOwner {
        if (_rebalancer == address(0)) revert ZeroAddress();
        rebalancer = _rebalancer;
    }

    /**
     * @notice Pause contract operations
     * @dev Only owner can pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract operations
     * @dev Only owner can unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw tokens
     * @param token Token address to withdraw
     * @param amount Amount to withdraw
     * @dev Only callable when paused, only by owner
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        if (!paused()) revert NotPaused();
        IERC20(token).safeTransfer(owner(), amount);
    }

    /* ========== STORAGE GAP ========== */

    /**
     * @dev Storage gap for future upgrades
     * @dev Reduced by 1 to account for STRATEGY_GAS_LIMIT constant
     */
    uint256[49] private __gap;
}
