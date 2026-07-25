export const proposalManager_abi = [
  {
    "type": "function",
    "name": "createProposal",
    "inputs": [
      { "name": "_title", "type": "string", "internalType": "string" },
      { "name": "_description", "type": "string", "internalType": "string" },
      {
        "name": "_auctionDuration",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_liveDuration",
        "type": "uint256",
        "internalType": "uint256"
      },
      { "name": "_subjectToken", "type": "string", "internalType": "string" },
      { "name": "_minToOpen", "type": "uint256", "internalType": "uint256" },
      { "name": "_maxCap", "type": "uint256", "internalType": "uint256" },
      { "name": "_target", "type": "address", "internalType": "address" },
      { "name": "_data", "type": "bytes", "internalType": "bytes" },
      { "name": "_pythAddr", "type": "address", "internalType": "address" },
      { "name": "_pythId", "type": "bytes32", "internalType": "bytes32" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deleteProposal",
    "inputs": [
      { "name": "_proposal", "type": "address", "internalType": "address" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeProposal",
    "inputs": [
      { "name": "_proposalId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAllProposals",
    "inputs": [],
    "outputs": [
      {
        "name": "proposals",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.ProposalInfo[]",
        "components": [
          { "name": "id", "type": "uint256", "internalType": "uint256" },
          { "name": "admin", "type": "address", "internalType": "address" },
          { "name": "title", "type": "string", "internalType": "string" },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum IProposal.State"
          },
          {
            "name": "auctionStartTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "auctionEndTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liveStart",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "liveEnd", "type": "uint256", "internalType": "uint256" },
          {
            "name": "liveDuration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subjectToken",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "minToOpen",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "maxCap", "type": "uint256", "internalType": "uint256" },
          {
            "name": "yesAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "yesToken",
            "type": "address",
            "internalType": "address"
          },
          { "name": "noToken", "type": "address", "internalType": "address" },
          {
            "name": "treasury",
            "type": "address",
            "internalType": "address"
          },
          { "name": "target", "type": "address", "internalType": "address" },
          { "name": "data", "type": "bytes", "internalType": "bytes" },
          {
            "name": "proposalAddress",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProposalById",
    "inputs": [
      { "name": "_proposalId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IProposalManager.ProposalInfo",
        "components": [
          { "name": "id", "type": "uint256", "internalType": "uint256" },
          { "name": "admin", "type": "address", "internalType": "address" },
          { "name": "title", "type": "string", "internalType": "string" },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum IProposal.State"
          },
          {
            "name": "auctionStartTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "auctionEndTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liveStart",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "liveEnd", "type": "uint256", "internalType": "uint256" },
          {
            "name": "liveDuration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subjectToken",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "minToOpen",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "maxCap", "type": "uint256", "internalType": "uint256" },
          {
            "name": "yesAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "yesToken",
            "type": "address",
            "internalType": "address"
          },
          { "name": "noToken", "type": "address", "internalType": "address" },
          {
            "name": "treasury",
            "type": "address",
            "internalType": "address"
          },
          { "name": "target", "type": "address", "internalType": "address" },
          { "name": "data", "type": "bytes", "internalType": "bytes" },
          {
            "name": "proposalAddress",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProposalsByAdmin",
    "inputs": [
      { "name": "_admin", "type": "address", "internalType": "address" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct IProposalManager.ProposalInfo[]",
        "components": [
          { "name": "id", "type": "uint256", "internalType": "uint256" },
          { "name": "admin", "type": "address", "internalType": "address" },
          { "name": "title", "type": "string", "internalType": "string" },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum IProposal.State"
          },
          {
            "name": "auctionStartTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "auctionEndTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liveStart",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "liveEnd", "type": "uint256", "internalType": "uint256" },
          {
            "name": "liveDuration",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subjectToken",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "minToOpen",
            "type": "uint256",
            "internalType": "uint256"
          },
          { "name": "maxCap", "type": "uint256", "internalType": "uint256" },
          {
            "name": "yesAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noAuction",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "yesToken",
            "type": "address",
            "internalType": "address"
          },
          { "name": "noToken", "type": "address", "internalType": "address" },
          {
            "name": "treasury",
            "type": "address",
            "internalType": "address"
          },
          { "name": "target", "type": "address", "internalType": "address" },
          { "name": "data", "type": "bytes", "internalType": "bytes" },
          {
            "name": "proposalAddress",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  }
] as const