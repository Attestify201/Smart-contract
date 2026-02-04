// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DeployConfig
 * @notice Centralized configuration for deployment
 * @dev All addresses and parameters in one place
 */
library DeployConfig {
    
    /* ========== CELO MAINNET ADDRESSES ========== */
    
    struct CeloAddresses {
        address cUSD;
        address aavePoolAddressesProvider;
    }
    
    function getCeloMainnet() internal pure returns (CeloAddresses memory) {
        return CeloAddresses({
            cUSD: 0x765DE816845861e75A25fCA122bb6898B8B1282a,
            aavePoolAddressesProvider: 0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5
        });
    }
    
    /* ========== CELO ALFAJORES TESTNET ========== */
    
    function getCeloAlfajores() internal pure returns (CeloAddresses memory) {
        return CeloAddresses({
            cUSD: 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1, // Alfajores cUSD
            aavePoolAddressesProvider: address(0) // MUST UPDATE
        });
    }
    
    /* ========== VAULT PARAMETERS ========== */
    
    struct VaultLimits {
        uint256 maxUserDeposit;
        uint256 maxTotalDeposit;
    }
    
    // Phase 1: Conservative launch
    function getPhase1Limits() internal pure returns (VaultLimits memory) {
        return VaultLimits({
            maxUserDeposit: 1_000 * 1e18,      // $1,000 per user
            maxTotalDeposit: 10_000 * 1e18     // $10,000 total
        });
    }
    
    // Phase 2: After 2 weeks of testing
    function getPhase2Limits() internal pure returns (VaultLimits memory) {
        return VaultLimits({
            maxUserDeposit: 10_000 * 1e18,     // $10,000 per user
            maxTotalDeposit: 100_000 * 1e18    // $100,000 total
        });
    }
    
    // Phase 3: After audit + 1 month
    function getPhase3Limits() internal pure returns (VaultLimits memory) {
        return VaultLimits({
            maxUserDeposit: 100_000 * 1e18,    // $100,000 per user
            maxTotalDeposit: 10_000_000 * 1e18 // $10M total
        });
    }
}