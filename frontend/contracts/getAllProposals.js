import { ethers } from "ethers";
import { proposalManager_abi } from "./proposalManager-abi.ts"

// RPC de Hedera Testnet EVM
const provider = new ethers.JsonRpcProvider("https://nameless-white-grass.hedera-testnet.quiknode.pro/b90250c6dd40f4212448350be2bed53ecb85b7d8");

// Dirección de tu contrato
const contractAddress = "0x789c93EF3F9c259cDB18BC750086DC5eb5454565";

async function main() {
  try {
    // Instancia del contrato
    const contract = new ethers.Contract(contractAddress, proposalManager_abi, provider);

    // Llamada a getAllProposals
    const proposals = await contract.getAllProposals();

    console.log("Proposals:");
    proposals.forEach((address, index) => {
      console.log(`Proposal ${index + 1}: ${address}`);
    });

  } catch (error) {
    console.error("Error llamando a getAllProposals:", error);
  }
}

main();
