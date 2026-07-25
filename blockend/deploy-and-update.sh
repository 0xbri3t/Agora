#!/bin/bash
# Aqua-era local deploy: the local anvil is a FORK of Sepolia, so the 1inch Aqua
# stack (aqua core, router, builder) and the MockUSDC collateral already exist.
# This script deploys the Agora governance stack on top, mints collateral to
# the dev accounts, and syncs addresses to frontend + backend.

set -euo pipefail

RPC=http://localhost:8545
ANVIL0_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ANVIL1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
COLLATERAL=0x34ad23A27Ae8A562928234D4415eD7225a44bB2E   # MockUSDC (Sepolia, present in fork)
PYTH=0xDd24F84d36BF92C65F92307595335bdFab5Bbd21          # Pyth (Sepolia, present in fork)
ETH_USD_FEED=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

echo "Deploying Agora stack to local Sepolia fork..."
DEPLOY_OUTPUT=$(DEPLOYER_PK=$ANVIL0_PK forge script script/DeployAgoraSepolia.s.sol --rpc-url $RPC --broadcast 2>&1) || {
  echo "Deployment failed!"; echo "$DEPLOY_OUTPUT"; exit 1
}

PROPOSAL_MANAGER=$(echo "$DEPLOY_OUTPUT" | grep "proposalManager:" | awk '{print $2}')
echo "ProposalManager: $PROPOSAL_MANAGER"

echo "Minting collateral (MockUSDC) to dev accounts..."
cast send $COLLATERAL "mint(address,uint256)" $ANVIL0 100000000000 --rpc-url $RPC --private-key $ANVIL0_PK > /dev/null
cast send $COLLATERAL "mint(address,uint256)" $ANVIL1 100000000000 --rpc-url $RPC --private-key $ANVIL0_PK > /dev/null

# Seed a demo proposal so the UI has something to show right away.
# The CCA counts BLOCKS: 6h/12s = 1800 blocks, which at the dev block time is
# an hour of wall clock — long enough to click through the auction by hand.
# Use `./dev.sh skip auction 1` to jump to the end whenever you want.
echo "Creating demo proposal..."
cast send $PROPOSAL_MANAGER \
  "createProposal(string,string,uint256,uint256,string,uint256,uint256,address,bytes,address,bytes32)" \
  "Adopt Aqua trading for Agora?" "Futarchy decides via YES/NO markets" \
  21600 3600 "ETH" 1000000000000000000 100000000000000000000 \
  0x0000000000000000000000000000000000000000 0x \
  $PYTH $ETH_USD_FEED \
  --rpc-url $RPC --private-key $ANVIL0_PK > /dev/null \
  && echo "Demo proposal created (id 1)" \
  || echo "Warning: demo proposal creation failed"

# Frontend addresses (merge: keep other chains' entries)
PM_FINAL=$PROPOSAL_MANAGER COLLATERAL_FINAL=$COLLATERAL node -e '
  const fs = require("fs");
  const file = "../frontend/contracts/deployed-addresses.json";
  let json = {};
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  json["31337"] = { COLLATERAL: process.env.COLLATERAL_FINAL, PROPOSAL_MANAGER: process.env.PM_FINAL };
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
'
echo "Updated frontend/contracts/deployed-addresses.json (31337)"

# Backend .env
ENV_FILE="../backend/.env"
if [ -f "$ENV_FILE" ]; then
  if sed --version >/dev/null 2>&1; then SED_I=(sed -i -E); else SED_I=(sed -i '' -E); fi
  for kv in "PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER" "COLLATERAL_ADDRESS=$COLLATERAL"; do
    key="${kv%%=*}"
    if grep -q "^$key=" "$ENV_FILE"; then
      "${SED_I[@]}" "s|^$key=.*|$kv|" "$ENV_FILE"
    else
      echo "$kv" >> "$ENV_FILE"
    fi
  done
  echo "Updated backend .env: PROPOSAL_MANAGER_ADDRESS, COLLATERAL_ADDRESS"
else
  echo "Warning: $ENV_FILE not found; skipping .env update."
fi

echo "Done. Agora (fork) ready — Aqua stack available at Sepolia addresses."
