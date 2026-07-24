#!/bin/bash

# Deploy contracts and mint COLLATERAL, then update frontend addresses
echo "Deploying contracts..."

# Run the deployment
DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)

# Check if deployment was successful
if [ $? -eq 0 ]; then
    echo "Deployment successful!"
    
    # Extract addresses from the deployment output
    PROPOSAL_MANAGER=$(echo "$DEPLOY_OUTPUT" | grep "ProposalManager:" | awk '{print $2}')
    COLLATERAL_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "COLLATERAL:" | awk '{print $2}')
    OWNER_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Owner:" | awk '{print $2}')

    echo "Now minting COLLATERAL..."

    # Defaults for minting
    TO_ADDRESS=${TO_ADDRESS:-$OWNER_ADDRESS}
    # Amount uses 6 decimals. Example: 1,000,000 COLLATERAL => 1_000_000 * 10^6 = 1000000000000
    AMOUNT_WEI=${AMOUNT_WEI:-100000000000000}

    if [ -z "$COLLATERAL_ADDRESS" ]; then
        echo "Error: Could not extract COLLATERAL address from deployment output."
        exit 1
    fi

    if [ -z "$TO_ADDRESS" ]; then
        # Fallback to default Anvil first account if not found in logs
        TO_ADDRESS=0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266
    fi

    # Run the COLLATERAL minting script
    MINT_OUTPUT=$(TO=$TO_ADDRESS AMOUNT=$AMOUNT_WEI COLLATERAL_CONTRACT=$COLLATERAL_ADDRESS forge script script/MintCollateral.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)

    # Check if COLLATERAL minting was successful
    if [ $? -eq 0 ]; then
        echo "COLLATERAL minting successful!"
        
        # Extract COLLATERAL address and balance from the minting output
        COLLATERAL_CONTRACT=$(echo "$MINT_OUTPUT" | grep "COLLATERAL Contract:" | awk '{print $3}')
        BAL=$(echo "$MINT_OUTPUT" | grep "User COLLATERAL Balance:" | tail -1 | awk '{print $4}')
        
        # Create/Update the JSON file used by frontend (merge: keep other chains' entries)
        ADDR_FILE=../frontend/contracts/deployed-addresses.json
        COLLATERAL_FINAL="${COLLATERAL_CONTRACT:-$COLLATERAL_ADDRESS}" PM_FINAL="$PROPOSAL_MANAGER" node -e '
          const fs = require("fs");
          const file = "../frontend/contracts/deployed-addresses.json";
          let json = {};
          try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
          json["31337"] = { COLLATERAL: process.env.COLLATERAL_FINAL, PROPOSAL_MANAGER: process.env.PM_FINAL };
          fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
        '

        # Update backend .env with ProposalManager address
        ENV_FILE="../backend/.env"
        if [ -z "$PROPOSAL_MANAGER" ]; then
            echo "Warning: Could not extract ProposalManager address from deploy output; skipping .env update."
        else
            if [ -f "$ENV_FILE" ]; then
                # macOS/BSD sed needs -i '' ; GNU sed needs -i. Detect once.
                if sed --version >/dev/null 2>&1; then SED_I=(sed -i -E); else SED_I=(sed -i '' -E); fi
                if grep -q '^PROPOSAL_MANAGER_ADDRESS=' "$ENV_FILE"; then
                    "${SED_I[@]}" "s|^PROPOSAL_MANAGER_ADDRESS=.*|PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER|" "$ENV_FILE"
                else
                    echo "" >> "$ENV_FILE"
                    echo "PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER" >> "$ENV_FILE"
                fi
                if grep -q '^COLLATERAL_ADDRESS=' "$ENV_FILE"; then
                    "${SED_I[@]}" "s|^COLLATERAL_ADDRESS=.*|COLLATERAL_ADDRESS=${COLLATERAL_CONTRACT:-$COLLATERAL_ADDRESS}|" "$ENV_FILE"
                else
                    echo "COLLATERAL_ADDRESS=${COLLATERAL_CONTRACT:-$COLLATERAL_ADDRESS}" >> "$ENV_FILE"
                fi
                echo "Updated backend .env: PROPOSAL_MANAGER_ADDRESS=$PROPOSAL_MANAGER COLLATERAL_ADDRESS=${COLLATERAL_CONTRACT:-$COLLATERAL_ADDRESS}"
            else
                echo "Warning: $ENV_FILE not found; skipping .env update."
            fi
        fi
        
        echo "Updated frontend/contracts/deployed-addresses.json with new addresses:"
        echo "COLLATERAL: ${COLLATERAL_CONTRACT:-$COLLATERAL_ADDRESS}"
        echo "ProposalManager: $PROPOSAL_MANAGER"
        echo "Recipient: $TO_ADDRESS"
        echo "User COLLATERAL Balance: $BAL COLLATERAL (6 decimals)"

        # Mint COLLATERAL to second Anvil account
        SECOND_ANVIL=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
        echo "Minting COLLATERAL to second Anvil account: $SECOND_ANVIL ..."
        MINT_OUTPUT_2=$(TO=$SECOND_ANVIL AMOUNT=$AMOUNT_WEI COLLATERAL_CONTRACT=$COLLATERAL_ADDRESS forge script script/MintCollateral.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 2>&1)
        if [ $? -eq 0 ]; then
            BAL_2=$(echo "$MINT_OUTPUT_2" | grep "User COLLATERAL Balance:" | tail -1 | awk '{print $4}')
            echo "Second account COLLATERAL mint successful!"
            echo "User COLLATERAL Balance (second account): $BAL_2 COLLATERAL (6 decimals)"
        else
            echo "COLLATERAL minting to second account failed!"
            echo "$MINT_OUTPUT_2"
        fi

    else
        echo "COLLATERAL minting failed!"
        echo "$MINT_OUTPUT"
        exit 1
    fi

else
    echo "Deployment failed!"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi
