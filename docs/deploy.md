# Deploy checklist

Everything here is scripted; what it needs is ETH.

## Deployer

`DEPLOYER_PRIVATE_KEY` in `.env` (never committed). The generated deployer for this repo's first deployment is `0x3863ec388E6deC9f01d7ECBDA87F55D0e8360C9e`. Fund it with:

- testnet 46630: any amount from the Chainlink or QuickNode faucet (`faucets.chain.link/robinhood-testnet`, `faucet.quicknode.com/robinhood/testnet`);
- mainnet 4663: 0.01 ETH bridged via the canonical Arbitrum bridge or Relay/Across covers every contract here many times over (each CREATE2 deploy is under 1.5M gas at sub-gwei prices).

## Order

```bash
cd contracts
# 1. testnet
forge script script/DeployMockUSDG.s.sol         --rpc-url $RHC_TESTNET_RPC_URL --broadcast
forge script script/DeployEscrow.s.sol           --rpc-url $RHC_TESTNET_RPC_URL --broadcast
(cd lib/erc-8004 && forge build) && forge script script/DeployAgentRegistries.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
# 2. mainnet (MockUSDG refuses mainnet by construction)
forge script script/DeployEscrow.s.sol           --rpc-url $RHC_MAINNET_RPC_URL --broadcast
forge script script/DeployAgentRegistries.s.sol  --rpc-url $RHC_MAINNET_RPC_URL --broadcast
```

Then write the MockUSDG address into `packages/chain/src/index.ts` (`TESTNET_USDG_ADDRESS`) and add the testnet row to the upstream PR.

## Verification on Blockscout

```bash
forge verify-contract 0xbE7523F2dd81cF23256342423A3CD898AA4E21E7 src/LoxleyEscrow.sol:LoxleyEscrow \
  --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api \
  --constructor-args $(cast abi-encode "constructor(address,uint256,address)" 0x000000000022D473030F116dDEE9F6B43aC78BA3 0 0x0000000000000000000000000000000000000000)
```

## Hosted services

- Facilitator: any Node 22 host. `FACILITATOR_PRIVATE_KEY` funded with ETH on 4663; `PUBLIC_URL` set; TLS in front. Health at `/health`, scrape `/metrics`.
- Scan: same host class, read-only RPC (Alchemy recommended for the backfill). Persist `data/scan.db`.
- Web: static, any CDN.

Suggested hostnames, already referenced by `KNOWN_FACILITATORS` and the landing page: `facilitator.loxley.dev`, `scan.loxley.dev`, `loxley.dev`.
