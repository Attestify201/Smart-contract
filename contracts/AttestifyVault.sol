// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import "./IAave.sol";

/**
 * @title AttestifyVault
 * @notice Main vault contract for yield generation
 * @dev Upgradeable vault using UUPS pattern, integrates with separate strategy contracts
 * 
 * Architecture:
 * - Vault: Holds user funds, manages shares
 * - Strategy: Deploys funds to yield sources (Aave)
 */
contract AttestifyVault is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES (DO NOT REORDER) ========== */
    
    // Core contracts
    IERC20 public asset;                    // cUSD token
    address public strategy;                // Aave strategy contract
    
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
    
    // Configuration
    uint256 public constant MIN_DEPOSIT = 1e18;        // 1 cUSD
    uint256 public maxUserDeposit;                      // Per user limit
    uint256 public maxTotalDeposit;                     // Total TVL limit
    uint256 public constant RESERVE_RATIO = 10;         // 10% kept in vault
    uint256 private constant VIRTUAL_SHARES = 1e3;      // Virtual liquidity to harden share price
    uint256 private constant VIRTUAL_ASSETS = 1e3;
    
    // Admin
    address public treasury;
    address public rebalancer;                          // Can be AI agent
    uint256 public lastRebalance;
    
    // Stats
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    
    /* ========== EVENTS ========== */
    
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);
    event Rebalanced(uint256 strategyBalance, uint256 reserveBalance, uint256 timestamp);
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);
    event LimitsUpdated(uint256 maxUser, uint256 maxTotal);
    
    /* ========== ERRORS ========== */
    
    error InvalidAmount();
    error ExceedsUserLimit();
    error ExceedsTVLLimit();
    error InsufficientShares();
    error InsufficientBalance();
    error ZeroAddress();
    error ExceedsBalance();
    error SlippageTooHigh();
    error StrategyDepositMismatch(uint256 expected, uint256 actual);
    
    /* ========== CONSTRUCTOR ========== */
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    /* ========== INITIALIZER ========== */
    
    /**
     * @notice Initialize vault (called once after proxy deployment)
     * @param _asset Underlying asset (cUSD)
     * @param _strategy Aave strategy contract
     * @param _maxUserDeposit Max deposit per user
     * @param _maxTotalDeposit Max total TVL
     */
    function initialize(
        address _asset,
        address _strategy,
        uint256 _maxUserDeposit,
        uint256 _maxTotalDeposit
    ) external initializer {
        if (_asset == address(0) || _strategy == address(0)) {
            revert ZeroAddress();
        }
        
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        
        asset = IERC20(_asset);
        strategy = _strategy;
        maxUserDeposit = _maxUserDeposit;
        maxTotalDeposit = _maxTotalDeposit;
        treasury = msg.sender;
        rebalancer = msg.sender;
    }
    
    /* ========== UPGRADE AUTHORIZATION ========== */
    
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyOwner 
    {}
    
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
    
   
    
    
    
    /* ========== DEPOSIT FUNCTIONS ========== */
    
    /**
     * @notice Deposit cUSD to earn yield
     * @param assets Amount of cUSD to deposit
     * @return sharesIssued Shares minted to user
     * @dev Requires prior ERC20 approval. Use depositWithPermit() for gasless approval.
     */
    function deposit(uint256 assets) 
        external 
        nonReentrant 
        whenNotPaused  
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
     * @notice Deposit with EIP-2612 permit (approve + deposit in one transaction)
     * @param assets Amount of cUSD to deposit
     * @param deadline Permit signature deadline (must be >= block.timestamp)
     * @param v Permit signature v component
     * @param r Permit signature r component
     * @param s Permit signature s component
     * @return sharesIssued Shares minted to user
     * @dev Allows gasless approval via EIP-2612 permit. 
     *      The permit function signature matches EIP-2612 standard:
     *      permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
     *      Reference: https://eips.ethereum.org/EIPS/eip-2612
     */
    function depositWithPermit(
        uint256 assets,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesIssued)
    {
        // Validation
        if (assets < MIN_DEPOSIT) revert InvalidAmount();
        if (assets > maxUserDeposit) revert ExceedsUserLimit();
        if (totalAssets() + assets > maxTotalDeposit) revert ExceedsTVLLimit();
        if (block.timestamp > deadline) revert InvalidAmount(); // Deadline must be in the future
        
        // Call permit to approve this contract to spend tokens on behalf of msg.sender
        // This follows EIP-2612 standard: permit(owner, spender, value, deadline, v, r, s)
        // Reference: https://www.quicknode.com/guides/ethereum-development/transactions/how-to-use-erc20-permit-approval
        IERC20Permit(address(asset)).permit(
            msg.sender,        // owner: token owner signing the permit
            address(this),     // spender: this vault contract
            assets,            // value: amount to approve
            deadline,          // deadline: signature expiration timestamp
            v,                 // v: signature component
            r,                 // r: signature component
            s                  // s: signature component
        );
        
        // Calculate shares
        sharesIssued = _convertToShares(assets);
        
        // Update state
        shares[msg.sender] += sharesIssued;
        totalShares += sharesIssued;
        userData[msg.sender].totalDeposited += assets;
        userData[msg.sender].lastActionTime = block.timestamp;
        totalDeposited += assets;
        
        // Transfer assets from user (now approved via permit)
        asset.safeTransferFrom(msg.sender, address(this), assets);
        
        // Deploy to strategy (keeping reserve)
        _deployToStrategy(assets);
        
        emit Deposited(msg.sender, assets, sharesIssued);
    }
    
    /**
     * @notice Internal function to deploy assets to strategy
     */
    function _deployToStrategy(uint256 amount) internal {
        uint256 reserveAmount = (amount * RESERVE_RATIO) / 100;
        uint256 deployAmount = amount - reserveAmount;
        
        if (deployAmount > 0) {
            // Approve strategy
            asset.forceApprove(strategy, deployAmount);
            
            // Call strategy deposit
            uint256 deposited = IVaultYieldStrategy(strategy).deposit(deployAmount);
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
     * @notice Withdraw with slippage/deadline style guard
     * @param assets Requested assets to withdraw
     * @param minAssetsOut Minimum acceptable assets after share conversion
     */
    function withdraw(uint256 assets, uint256 minAssetsOut)
        public
        nonReentrant
        returns (uint256 sharesBurned)
    {
        return _processWithdraw(msg.sender, assets, minAssetsOut);
    }
    
    /**
     * @notice Withdraw all user's balance
     */
    function withdrawAll() external returns (uint256 sharesBurned) {
        uint256 userAssets = balanceOf(msg.sender);
        return withdraw(userAssets, userAssets);
    }
    
    /**
     * @notice Internal function to withdraw from strategy
     */
    function _withdrawFromStrategy(uint256 amount) internal {
        uint256 received = IVaultYieldStrategy(strategy).withdraw(amount);
        if (received < amount) revert InsufficientBalance();
    }

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

        emit Withdrawn(user, assetsOut, sharesBurned);
    }

    function _ensureReserveRatio() internal {
        uint256 _totalAssets = totalAssets();
        if (_totalAssets == 0) return;

        uint256 targetReserve = (_totalAssets * RESERVE_RATIO) / 100;
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
     */
    function totalAssets() public view returns (uint256) {
        uint256 reserveBalance = asset.balanceOf(address(this));
        
        uint256 strategyBalance = 0;
        if (strategy != address(0)) {
            try IVaultYieldStrategy(strategy).totalAssets() returns (uint256 balance) {
                strategyBalance = balance;
            } catch {
                strategyBalance = 0;
            }
        }
        
        return reserveBalance + strategyBalance;
    }
    
    /**
     * @notice Get user's balance in assets
     * @param user User address
     * @return Balance in cUSD
     */
    function balanceOf(address user) public view returns (uint256) {
        return _convertToAssets(shares[user]);
    }
    
    /**
     * @notice Get user's earnings
     * @param user User address
     * @return Total earnings
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
     */
    function _convertToShares(uint256 assets) internal view returns (uint256) {
        uint256 adjustedShares = totalShares + VIRTUAL_SHARES;
        uint256 adjustedAssets = totalAssets() + VIRTUAL_ASSETS;
        return (assets * adjustedShares) / adjustedAssets;
    }
    
    /**
     * @notice Convert shares to assets
     */
    function _convertToAssets(uint256 _shares) internal view returns (uint256) {
        if (totalShares == 0) return 0;
        uint256 adjustedShares = totalShares + VIRTUAL_SHARES;
        uint256 adjustedAssets = totalAssets() + VIRTUAL_ASSETS;
        return (_shares * adjustedAssets) / adjustedShares;
    }
    
    /* ========== REBALANCE ========== */
    
    /**
     * @notice Rebalance between strategy and reserve
     */
    function rebalance() external {
        require(msg.sender == owner() || msg.sender == rebalancer, "Unauthorized");
        
        uint256 _totalAssets = totalAssets();
        uint256 targetReserve = (_totalAssets * RESERVE_RATIO) / 100;
        uint256 currentReserve = asset.balanceOf(address(this));
        
        if (currentReserve < targetReserve) {
            // Need more in reserve
            uint256 needed = targetReserve - currentReserve;
            _withdrawFromStrategy(needed);
        } else if (currentReserve > targetReserve * 2) {
            // Too much in reserve
            uint256 excess = currentReserve - targetReserve;
            _deployToStrategy(excess);
        }
        
        lastRebalance = block.timestamp;
        
        // Get updated balances
        uint256 strategyBalance = 0;
        if (strategy != address(0)) {
            try IVaultYieldStrategy(strategy).totalAssets() returns (uint256 balance) {
                strategyBalance = balance;
            } catch {
                strategyBalance = 0;
            }
        }
        
        emit Rebalanced(strategyBalance, asset.balanceOf(address(this)), block.timestamp);
    }
    
    /* ========== ADMIN FUNCTIONS ========== */
    
    function setStrategy(address _strategy) external onlyOwner {
        if (_strategy == address(0)) revert ZeroAddress();
        address old = strategy;
        strategy = _strategy;
        emit StrategyUpdated(old, _strategy);
    }
    
    function setLimits(uint256 _maxUser, uint256 _maxTotal) external onlyOwner {
        maxUserDeposit = _maxUser;
        maxTotalDeposit = _maxTotal;
        emit LimitsUpdated(_maxUser, _maxTotal);
    }
    
    function setRebalancer(address _rebalancer) external onlyOwner {
        if (_rebalancer == address(0)) revert ZeroAddress();
        rebalancer = _rebalancer;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        require(paused(), "Must be paused");
        IERC20(token).safeTransfer(owner(), amount);
    }
    
    /* ========== STORAGE GAP ========== */
    uint256[50] private __gap;
}