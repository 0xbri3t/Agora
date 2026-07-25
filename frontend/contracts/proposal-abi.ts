export const proposal_abi = [
     {
      "type": "function",
      "name": "admin",
      "inputs": [],
      "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "auctionEndTime",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "auctionStartTime",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "description",
      "inputs": [],
      "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "id",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "initialize",
      "inputs": [
        { "name": "_id", "type": "uint256", "internalType": "uint256" },
        { "name": "_admin", "type": "address", "internalType": "address" },
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
        { "name": "_pyUSD", "type": "address", "internalType": "address" },
        { "name": "_minToOpen", "type": "uint256", "internalType": "uint256" },
        { "name": "_maxCap", "type": "uint256", "internalType": "uint256" },
        { "name": "_target", "type": "address", "internalType": "address" },
        { "name": "_data", "type": "bytes", "internalType": "bytes" },
        { "name": "_pythAddr", "type": "address", "internalType": "address" },
        { "name": "_pythId", "type": "bytes32", "internalType": "bytes32" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "liveDuration",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "liveEnd",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "liveStart",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "maxCap",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "minToOpen",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "noAuction",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract DutchAuction"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "noToken",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract MarketToken"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "pyUSD",
      "inputs": [],
      "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "resolve",
      "inputs": [],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "settleAuctions",
      "inputs": [],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "state",
      "inputs": [],
      "outputs": [
        { "name": "", "type": "uint8", "internalType": "enum IProposal.State" }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "subjectToken",
      "inputs": [],
      "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "title",
      "inputs": [],
      "outputs": [{ "name": "", "type": "string", "internalType": "string" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "treasury",
      "inputs": [],
      "outputs": [
        { "name": "", "type": "address", "internalType": "contract Treasury" }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "yesAuction",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract DutchAuction"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "yesToken",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract MarketToken"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "twapPriceTokenYes",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "twapPriceTokenNo",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "claimTokens",
      "inputs": [
        { "name": "_tokenToClaim", "type": "address", "internalType": "address" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    }
] as const
