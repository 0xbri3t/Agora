#!/bin/bash

# Deploy contracts and mint PYUSD, then update frontend addresses
echo "Deploying contracts..."

# Run the deployment
DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)

# Check if deployment was successful
if [ $? -eq 0 ]; then
    echo "Deployment successful!"
    
    # Extract addresses from the deployment output
    PROPOSAL_MANAGER=$(echo "$DEPLOY_OUTPUT" | grep "ProposalManager:" | awk '{print $2}')
    PYUSD_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "PYUSD:" | awk '{print $2}')
    OWNER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Owner:" | awk '{print $2}')

    echo "Now minting PYUSD..."

    # Defaults for minting
    TO_ADDRESS=${TO_ADDRESS:-$OWNER_ADDRESS}
    # Amount uses 6 decimals. Example: 1,000,000 PYUSD => 1_000_000 * 10^6 = 1000000000000
    AMOUNT_WEI=${AMOUNT_WEI:-100000000000000}

    if [ -z "$PYUSD_ADDRESS" ]; then
        echo "Error: Could not extract PYUSD address from deployment output."
        exit 1
    fi

    if [ -z "$TO_ADDRESS" ]; then
        # Fallback to default Anvil first account if not found in logs
        TO_ADDRESS=0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    fi

    # Run the PYUSD minting script
    PYUSD_MINT_OUTPUT=$(TO=$TO_ADDRESS AMOUNT=$AMOUNT_WEI PYUSD_CONTRACT=$PYUSD_ADDRESS forge script script/Mintpyusd.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)

    # Check if PYUSD minting was successful
    if [ $? -eq 0 ]; then
        echo "PYUSD minting successful!"
        
        # Extract PYUSD address and balance from the minting output
        PYUSD_CONTRACT=$(echo "$PYUSD_MINT_OUTPUT" | grep "PYUSD Contract:" | awk '{print $3}')
        PYUSD_BALANCE=$(echo "$PYUSD_MINT_OUTPUT" | grep "User PYUSD Balance:" | tail -1 | awk '{print $4}')
        
        # Create/Update the JSON file used by frontend
        cat > ../frontend/contracts/deployed-addresses.json << EOF
{
  "31337": {
    "PYUSD": "${PYUSD_CONTRACT:-$PYUSD_ADDRESS}",
    "PROPOSAL_MANAGER": "$PROPOSAL_MANAGER"
  }
}
EOF

        # Update backend .env with ProposalManager address
        ENV_FILE="../backend/.env"
        if [ -z "$PROPOSAL_MANAGER" ]; then
            echo "Warning: Could not extract ProposalManager address from deploy output; skipping .env update."
        else
            if [ -f "$ENV_FILE" ]; then
                if grep -q '^PROPOSAL_MANAGER_ADDRESS=' "$ENV_FILE"; then
                    sed -i -E "s|^PROPOSAL_MANAGER_ADDRESS=.*|PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER|" "$ENV_FILE"
                else
                    echo "" >> "$ENV_FILE"
                    echo "PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER" >> "$ENV_FILE"
                fi
                echo "Updated backend .env with PROPOSAL_MANAGER_ADDRESS: $PROPOSAL_MANAGER"
            else
                echo "Warning: $ENV_FILE not found; skipping .env update."
            fi
        fi
        
        echo "Updated frontend/contracts/deployed-addresses.json with new addresses:"
        echo "PYUSD: ${PYUSD_CONTRACT:-$PYUSD_ADDRESS}"
        echo "ProposalManager: $PROPOSAL_MANAGER"
        echo "Recipient: $TO_ADDRESS"
        echo "User PYUSD Balance: $PYUSD_BALANCE PYUSD (6 decimals)"

        # Mint PYUSD to second Anvil account
        SECOND_ANVIL=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
        echo "Minting PYUSD to second Anvil account: $SECOND_ANVIL ..."
        PYUSD_MINT_OUTPUT_2=$(TO=$SECOND_ANVIL AMOUNT=$AMOUNT_WEI PYUSD_CONTRACT=$PYUSD_ADDRESS forge script script/Mintpyusd.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)
        if [ $? -eq 0 ]; then
            PYUSD_BALANCE_2=$(echo "$PYUSD_MINT_OUTPUT_2" | grep "User PYUSD Balance:" | tail -1 | awk '{print $4}')
            echo "Second account PYUSD mint successful!"
            echo "User PYUSD Balance (second account): $PYUSD_BALANCE_2 PYUSD (6 decimals)"
        else
            echo "PYUSD minting to second account failed!"
            echo "$PYUSD_MINT_OUTPUT_2"
        fi

    else
        echo "PYUSD minting failed!"
        echo "$PYUSD_MINT_OUTPUT"
        exit 1
    fi

else
    echo "Deployment failed!"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi
