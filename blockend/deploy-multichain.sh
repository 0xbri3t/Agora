#!/bin/bash

# Multi-chain deployment script for Anvil and Hedera Testnet
# Configure your private key as environment variable

# Check if required environment variables are set
if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY environment variable is not set"
    echo "Please set it with: export PRIVATE_KEY=your_private_key"
    exit 1
fi

# Network configurations
ANVIL_RPC="http://localhost:8545"
HEDERA_RPC="https://testnet.hashio.io/api"

# For local development, you can use the default anvil key
LOCAL_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

echo "Starting multi-chain deployment..."

# Function to deploy on a specific network
deploy_on_network() {
    local network_name=$1
    local rpc_url=$2
    local private_key=$3
    local chain_id=$4
    
    echo "Deploying on $network_name (Chain ID: $chain_id)..."
    
    # Run deployment with timeout
    timeout 300 forge script script/Deploy.s.sol --rpc-url "$rpc_url" --private-key "$private_key" --broadcast > /tmp/deploy_output.log 2>&1
    DEPLOY_EXIT_CODE=$?
    DEPLOY_OUTPUT=$(cat /tmp/deploy_output.log)
    
    if [ $DEPLOY_EXIT_CODE -eq 124 ]; then
        echo "$network_name deployment timed out (5 minutes)"
        return 1
    elif [ $DEPLOY_EXIT_CODE -eq 0 ]; then
        echo "$network_name deployment successful"
        
        # Extract addresses from output
        PROPOSAL_MANAGER=$(echo "$DEPLOY_OUTPUT" | grep "ProposalManager:" | awk '{print $2}')
        PROPOSAL_IMPL=$(echo "$DEPLOY_OUTPUT" | grep "Proposal Implementation:" | awk '{print $3}')
        MARKET_IMPL=$(echo "$DEPLOY_OUTPUT" | grep "Market Implementation:" | awk '{print $3}')
        MARKET_TOKEN_IMPL=$(echo "$DEPLOY_OUTPUT" | grep "MarketToken Implementation:" | awk '{print $3}')
        
        echo "$network_name addresses:"
        echo "  ProposalManager: $PROPOSAL_MANAGER"
        echo "  Proposal Impl: $PROPOSAL_IMPL"
        echo "  Market Impl: $MARKET_IMPL"
        echo "  MarketToken Impl: $MARKET_TOKEN_IMPL"
        
        # Store addresses in a temporary file for later processing
        cat >> /tmp/multichain_addresses.json << EOF
  "$chain_id": {
    "PROPOSAL_MANAGER": "$PROPOSAL_MANAGER",
    "PROPOSAL_IMPL": "$PROPOSAL_IMPL",
    "MARKET_IMPL": "$MARKET_IMPL",
    "MARKET_TOKEN_IMPL": "$MARKET_TOKEN_IMPL"
  },
EOF
        
        return 0
    else
        echo "$network_name deployment failed"
        if [ $DEPLOY_EXIT_CODE -ne 124 ]; then
            echo "Error details:"
            echo "$DEPLOY_OUTPUT" | tail -10
        fi
        return 1
    fi
}

# Create temporary file for addresses
echo "{" > /tmp/multichain_addresses.json

# Deploy on Anvil (local)
echo "Checking if Anvil is running..."
if curl -s -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' $ANVIL_RPC > /dev/null 2>&1; then
    deploy_on_network "Anvil (Local)" "$ANVIL_RPC" "$LOCAL_PRIVATE_KEY" "31337"
    ANVIL_SUCCESS=$?
else
    echo "Anvil is not running. Skipping local deployment."
    ANVIL_SUCCESS=1
fi

# Deploy on Hedera Testnet
deploy_on_network "Hedera Testnet" "$HEDERA_RPC" "$PRIVATE_KEY" "296"
HEDERA_SUCCESS=$?

# Remove trailing comma and close JSON
sed -i '$ s/,$//' /tmp/multichain_addresses.json
echo "}" >> /tmp/multichain_addresses.json

# Update frontend addresses file
if [ -f /tmp/multichain_addresses.json ]; then
    cp /tmp/multichain_addresses.json ../frontend/contracts/deployed-addresses.json
    echo "Updated frontend/contracts/deployed-addresses.json"
fi

# Summary
echo ""
echo "Deployment Summary:"
if [ $ANVIL_SUCCESS -eq 0 ]; then
    echo "Anvil (Local): Success"
else
    echo "Anvil (Local): Failed or Skipped"
fi

if [ $HEDERA_SUCCESS -eq 0 ]; then
    echo "Hedera: Success"
else
    echo "Hedera: Failed"
fi

# Clean up
rm -f /tmp/multichain_addresses.json
rm -f /tmp/deploy_output.log

echo ""
echo "Multi-chain deployment completed"
