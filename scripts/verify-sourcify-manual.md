# Manual Sourcify Verification Guide

## Contract Addresses (Celo Mainnet - Chain ID: 42220)

- **AaveV3Strategy**: `0x1ed36feb312b9d464d95fc1bab4b286ddc793341`
- **AttestifyVault Implementation**: `0xbe70318eb8772d265642a2ab6fee32cd250ec844`
- **Vault Proxy**: `0x16a0ff8d36d9d660de8fd5257cff78adf11b8306`

## Verification Steps

### Option 1: Using Sourcify Web Interface

1. Go to https://sourcify.dev
2. Click "Verify Contract"
3. Select **Celo Mainnet** (Chain ID: 42220)
4. Enter the contract address
5. Upload the contract source files:
   - For AaveV3Strategy: `contracts/AaveV3Strategy.sol`
   - For AttestifyVault: `contracts/AttestifyVault.sol` and `contracts/IAave.sol`
6. Click "Verify"

### Option 2: Using Sourcify Repository

1. Go to https://repo.sourcify.dev
2. Navigate to: `contracts/full_match/42220/` (for Celo Mainnet)
3. Check if your contracts are already verified

### Option 3: Using Hardhat Verify Plugin

Install the verify plugin and use:
```bash
npx hardhat verify --network celoMainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

## Files Needed for Verification

### AaveV3Strategy
- `contracts/AaveV3Strategy.sol`
- Metadata from `artifacts/contracts/AaveV3Strategy.sol/AaveV3Strategy.json`

### AttestifyVault  
- `contracts/AttestifyVault.sol`
- `contracts/IAave.sol`
- Metadata from `artifacts/contracts/AttestifyVault.sol/AttestifyVault.json`

## Direct Links

After verification, your contracts will be available at:
- Strategy: https://sourcify.dev/#/contracts/full_match/42220/0x1ed36feb312b9d464d95fc1bab4b286ddc793341
- Vault: https://sourcify.dev/#/contracts/full_match/42220/0xbe70318eb8772d265642a2ab6fee32cd250ec844
