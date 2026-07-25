# FutarFi DeFi Protocol API

## Overview
Backend API for the FutarFi DeFi Protocol with real-time WebSocket support, limit/market orders, and comprehensive market data.

## Features

### Wallet Authentication System
- Cryptographic signature verification using ethers.js
- Time-based message validation (5-minute expiry)
- Address recovery from signature to prevent spoofing
- Protected endpoints requiring valid wallet signatures
- Middleware-based authentication for secure operations

### Order Matching Engine
- Automatic order execution on creation
- Price-time priority matching algorithm
- Same-side, opposite-type matching logic
- Supports both limit and market orders
- Partial fill handling with remaining order management
- Cross-order matching for existing orders

### WebSocket Real-time Updates
- Real-time order book updates
- Live order status changes
- Instant order matching notifications
- Market data streaming
- Proposal updates

### Market Orders Support
- Limit Orders: Traditional orders with specific price
- Market Orders: Execute immediately at best available price
- Order matching engine with automatic execution
- Partial fills support with status tracking

### Enhanced Market Data
- 24h volume tracking
- Price change calculations
- Market depth analysis
- Candlestick/OHLCV data
- Trade history
- Spread calculations

### Real-time Dashboard
- Live system statistics
- Active proposals monitoring
- Recent trades feed
- Market overview

## API Endpoints

### Authentication
```
POST /api/auth/message - Generate authentication message
POST /api/auth/verify - Verify wallet signature
```

### Orderbooks (Protected Endpoints)
```
POST /api/orderbooks/:proposalId/:side/orders - Create order (requires wallet signature)
DELETE /api/orderbooks/orders/:orderId - Cancel order (requires wallet signature)
POST /api/orderbooks/my-orders - Get user's orders (requires wallet signature)
POST /api/orderbooks/my-orders/:proposalId - Get user's orders for proposal (requires wallet signature)
POST /api/orderbooks/my-trades - Get user's trading history (requires wallet signature)
```

### Orderbooks (Public Endpoints)
```
GET /api/orderbooks/:proposalId/:side/market-data - Public market data
GET /api/orderbooks/:proposalId/:side/twap - TWAP data
GET /api/orderbooks/:proposalId/:side/candles - Candlestick data
```



### Proposals
```
GET /api/proposals - Get all proposals (public)
GET /api/proposals/:id - Get proposal by ID (public)
GET /api/proposals/:id/stats - Proposal statistics (public)
GET /api/proposals/with-market-data - Proposals with market data (public)
POST /api/proposals - Create proposal (requires wallet signature)
PUT /api/proposals/:id - Update proposal (requires wallet signature, creator only)
DELETE /api/proposals/:id - Delete proposal (requires wallet signature, creator only)
```

### Real-time Data
```
GET /api/realtime/dashboard - Real-time dashboard data
GET /api/realtime/health - System health metrics
GET /api/realtime/market-overview - Market overview
GET /api/realtime/websocket-info - WebSocket connection info
```

## Authentication Flow

### 1. Generate Authentication Message
```bash
curl -X POST http://localhost:3001/api/auth/message \
  -H "Content-Type: application/json" \
  -d '{"address": "0x1234..."}'
```

Response:
```json
{
  "message": "FutarFi Authentication\nAddress: 0x1234...\nTimestamp: 1698765432000",
  "timestamp": 1698765432000,
  "instructions": "Sign this message with your wallet"
}
```

### 2. Sign Message with Wallet
Use your wallet (MetaMask, etc.) to sign the message received from step 1.

### 3. Use Signature for Protected Endpoints
Include authentication data in request body for protected endpoints:
```json
{
  "address": "0x1234...",
  "signature": "0xabcdef...",
  "message": "FutarFi Authentication\nAddress: 0x1234...\nTimestamp: 1698765432000",
  "timestamp": 1698765432000,
  
  "orderType": "buy",
  "orderExecution": "limit",
  "price": "1.5",
  "amount": "100"
}
```

## Order Types

### Limit Orders (with Authentication)
```json
{
  "address": "0x1234...",
  "signature": "0xabcdef...",
  "message": "FutarFi Authentication\nAddress: 0x1234...\nTimestamp: 1698765432000",
  "timestamp": 1698765432000,
  
  "orderType": "buy|sell",
  "orderExecution": "limit",
  "price": "1.5",
  "amount": "100"
}
```

### Market Orders (with Authentication)
```json
{
  "address": "0x1234...",
  "signature": "0xabcdef...",
  "message": "FutarFi Authentication\nAddress: 0x1234...\nTimestamp: 1698765432000",
  "timestamp": 1698765432000,
  
  "orderType": "buy|sell",
  "orderExecution": "market",
  "amount": "100"
}
```

## Order Matching Logic

### Same-Side Matching
Orders are matched on the same side (approve/reject) with opposite types (buy/sell):
- Buy approve tokens matches with Sell approve tokens
- Buy reject tokens matches with Sell reject tokens
- Sell approve tokens matches with Buy approve tokens  
- Sell reject tokens matches with Buy reject tokens

### Price Priority
- Buy orders: Match with sells at or below the buy price (best price first)
- Sell orders: Match with buys at or above the sell price (best price first)
- Market orders: Execute at best available price immediately

### Execution Flow
1. Order created and saved to database
2. Automatic execution attempt against existing orders
3. Re-check existing orders for new matches
4. WebSocket notifications sent to clients
5. Order book updated with new state

## WebSocket Usage

Connect to WebSocket server:
```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3001');
```

Join rooms:
```javascript
socket.emit('join-proposal', 'proposal-id');
socket.emit('join-orderbook', 'proposal-id', 'approve');
```

Listen to events:
```javascript
socket.on('new-order', (data) => console.log('New order:', data.order));
socket.on('orderbook-update', (data) => console.log('Orderbook updated:', data.orderBook));
socket.on('order-matched', (data) => console.log('Orders matched:', data));
socket.on('market-data', (data) => console.log('Market data:', data));
```

## Setup

### Docker
```bash
./setup.sh    # Initial setup with Docker
./stop.sh     # Stop Docker services
```


## Database Schema

### Proposal Model
```javascript
{
  id: Number,
  admin: String,
  title: String,
  description: String,
  startTime: Number,
  endTime: Number,
  duration: Number,
  collateralToken: String,
  maxSupply: String,
  target: String,
  data: String,
  marketAddress: String,
  proposalExecuted: Boolean,
  proposalEnded: Boolean,
  isActive: Boolean,
  // Virtual fields
  approveToken: String, // Generated from marketAddress
  rejectToken: String,  // Generated from marketAddress
  createdAt: Date,
  updatedAt: Date
}
```

### Order Model
```javascript
{
  proposalId: String,
  side: 'approve' | 'reject',
  orderType: 'buy' | 'sell',
  orderExecution: 'limit' | 'market',
  price: String, // Required for limit orders
  amount: String,
  filledAmount: String,
  slippage: String, // Optional, for information only
  executedPrice: String, // Average weighted execution price
  fills: [{ // Order execution history
    price: String,
    amount: String,
    timestamp: Date,
    matchedOrderId: String
  }],
  userAddress: String,
  status: 'open' | 'filled' | 'cancelled' | 'partial',
  txHash: String,
  createdAt: Date,
  updatedAt: Date
}
```

### OrderBook Model
```javascript
{
  proposalId: String,
  side: 'approve' | 'reject',
  bids: [OrderBookEntry],
  asks: [OrderBookEntry],
  lastPrice: String,
  volume24h: String,
  high24h: String,
  low24h: String,
  priceChange24h: String,
  priceChangePercent24h: String,
  twap1h: String,
  twap4h: String,
  twap24h: String,
  twapLastUpdate: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### OrderBookEntry Schema
```javascript
{
  price: String,
  amount: String,
  orderCount: Number
}
```

### PriceHistory Model
```javascript
{
  proposalId: String,
  side: 'approve' | 'reject',
  price: String,
  volume: String,
  timestamp: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### TWAP Model
```javascript
{
  proposalId: String,
  side: 'approve' | 'reject',
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '24h',
  twapPrice: String,
  volume: String,
  timestamp: Date,
  pricePoints: [{
    price: String,
    amount: String,
    timestamp: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

## Features

- Indexed database queries for fast retrieval
- Aggregation pipelines for market data
- Rate limiting for API protection
- WebSocket real-time notifications
- Order matching engine
- Comprehensive market data analytics

## Security Features

### Wallet Authentication Validation
- Cryptographic signature verification prevents address spoofing
- Message format validation ensures consistent authentication
- Time-based expiry (5 minutes) prevents replay attacks
- Address recovery from signature confirms wallet ownership

### Protected Endpoints
All trading operations require valid wallet signatures:
- Order creation and cancellation (user can only cancel their own orders)
- User-specific data retrieval (users can only see their own orders and trades)
- Proposal management (creator-only operations)

### Data Isolation
- Each user can only access their own orders and trading history
- Order cancellation restricted to order creator only  
- Address verification through cryptographic signature prevents spoofing
- Database queries automatically filter by authenticated user address

### Public Endpoints
Market data endpoints remain public for transparency:
- Market statistics and TWAP data
- Candlestick/price history
- Proposal information

## Testing

### Public Endpoints
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/realtime/dashboard
curl http://localhost:3001/api/proposals
curl http://localhost:3001/api/orderbooks/111/approve/market-data
```

### Protected Endpoints (require wallet signature)
```bash
# 1. Generate message
curl -X POST http://localhost:3001/api/auth/message \
  -H "Content-Type: application/json" \
  -d '{"address": "0x1234567890123456789012345678901234567890"}'

# 2. Sign the message with your wallet, then use signature:
curl -X POST http://localhost:3001/api/orderbooks/111/approve/orders \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x1234567890123456789012345678901234567890",
    "signature": "0xYOUR_SIGNATURE_HERE",
    "message": "FutarFi Authentication\nAddress: 0x1234567890123456789012345678901234567890\nTimestamp: 1698765432000",
    "timestamp": 1698765432000,
    "orderType": "buy",
    "orderExecution": "limit",
    "price": "1.2",
    "amount": "100"
  }'
```

### Testing Without Valid Signature (should fail)
```bash
curl -X POST http://localhost:3001/api/orderbooks/my-orders \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: {"error":"Wallet authentication required","required":["address","signature","message","timestamp"]}
```

## Dependencies

- socket.io: WebSocket support
- express: Web framework
- mongoose: MongoDB ODM
- joi: Validation
- cors: Cross-origin requests
- helmet: Security headers
