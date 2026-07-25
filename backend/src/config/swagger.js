const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FutarFi DeFi Protocol API',
      version: '1.0.0',
      description: 'Backend API (TEE) for the FutarFi DeFi Protocol with real-time WebSocket support, limit/market orders, and comprehensive market data.'
    },
    // Use a relative server URL by default so Swagger UI "Try it out"
    // targets the same origin/port the API is served from. Override via SWAGGER_SERVER_URL if needed.
    servers: [
      {
        url: process.env.SWAGGER_SERVER_URL || '/',
        description: process.env.SWAGGER_SERVER_DESCRIPTION || 'API server'
      }
    ],
    components: {
      securitySchemes: {
        WalletSignature: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'WalletSignature',
          description: 'Wallet signature authentication. Requires address, signature, message, and timestamp in request body.'
        }
      },
      schemas: {
        Proposal: {
          type: 'object',
          required: ['id', 'admin', 'title', 'description', 'collateralToken', 'maxSupply', 'target'],
          properties: {
            id: {
              type: 'integer',
              description: 'Unique proposal identifier'
            },
            proposalAddress: {
              type: 'string',
              description: 'Proposal contract address'
            },
            proposalContractId: {
              type: 'string',
              description: 'On-chain proposal id (uint256) as string'
            },
            admin: {
              type: 'string',
              description: 'Address of the proposal administrator'
            },
            title: {
              type: 'string',
              description: 'Proposal title'
            },
            description: {
              type: 'string',
              description: 'Detailed proposal description'
            },
            startTime: {
              type: 'integer',
              description: 'Proposal start time (Unix timestamp)'
            },
            endTime: {
              type: 'integer',
              description: 'Proposal end time (Unix timestamp)'
            },
            duration: {
              type: 'integer',
              description: 'Proposal duration in seconds',
              default: 86400
            },
            collateralToken: {
              type: 'string',
              description: 'Collateral token address'
            },
            maxSupply: {
              type: 'string',
              description: 'Maximum token supply'
            },
            target: {
              type: 'string',
              description: 'Target contract address'
            },
            data: {
              type: 'string',
              description: 'Additional proposal data'
            },
            marketAddress: {
              type: 'string',
              description: 'Market contract address'
            },
            proposalExecuted: {
              type: 'boolean',
              description: 'Whether the proposal has been executed'
            },
            proposalEnded: {
              type: 'boolean',
              description: 'Whether the proposal has ended'
            },
            isActive: {
              type: 'boolean',
              description: 'Whether the proposal is currently active'
            }
          }
        },
        Order: {
          type: 'object',
          required: ['orderType', 'amount', 'userAddress'],
          properties: {
            orderType: {
              type: 'string',
              enum: ['buy', 'sell'],
              description: 'Type of order'
            },
            orderExecution: {
              type: 'string',
              enum: ['limit', 'market'],
              default: 'limit',
              description: 'Order execution type'
            },
            price: {
              type: 'string',
              description: 'Order price (required for limit orders)'
            },
            amount: {
              type: 'string',
              description: 'Order amount'
            },
            userAddress: {
              type: 'string',
              description: 'User wallet address'
            },
            slippage: {
              type: 'string',
              description: 'Maximum acceptable slippage (informational only)'
            },
            txHash: {
              type: 'string',
              description: 'Transaction hash'
            }
          }
        },
        OrderBook: {
          type: 'object',
          properties: {
            proposalId: {
              type: 'string',
              description: 'Associated proposal ID'
            },
            side: {
              type: 'string',
              enum: ['approve', 'reject'],
              description: 'Order book side'
            },
            bids: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/OrderBookEntry'
              }
            },
            asks: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/OrderBookEntry'
              }
            },
            lastPrice: {
              type: 'string',
              description: 'Last traded price'
            },
            volume24h: {
              type: 'string',
              description: '24-hour trading volume'
            },
            high24h: {
              type: 'string',
              description: '24-hour high price'
            },
            low24h: {
              type: 'string',
              description: '24-hour low price'
            },
            priceChange24h: {
              type: 'string',
              description: '24-hour price change'
            }
          }
        },
        OrderBookEntry: {
          type: 'object',
          properties: {
            price: {
              type: 'string',
              description: 'Price level'
            },
            amount: {
              type: 'string',
              description: 'Total amount at price level'
            },
            orderCount: {
              type: 'integer',
              description: 'Number of orders at price level'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            }
          }
        },
        HealthStatus: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'OK'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js', './src/server.js']
};

const specs = swaggerJsdoc(options);

module.exports = specs;
