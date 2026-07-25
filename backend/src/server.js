try { require('dotenv').config(); } catch (_) { /* dotenv optional in Docker/local */ }
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

const connectDB = require('./config/database');
const proposalsRouter = require('./routes/proposals');
const orderbooksRouter = require('./routes/orderbooks');
const authRouter = require('./routes/auth');
const realtimeRouter = require('./routes/realtime');
const rateLimit = require('./middleware/rateLimit');
const { ethers } = require('ethers');

// New: chain routes
const chainRouter = require('./routes/chain');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Make io accessible to routes via req.app.get('io') as used in code
app.set('io', io);

const PORT = process.env.PORT || 3001;

// Connect to database
connectDB();

app.use((req, res, next) => {
  req.io = io;
  next();
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Client must authenticate once per connection with signed message
  socket.on('auth-wallet', ({ address, signature, message, timestamp }) => {
    try {
      if (!address || !signature || !message || !timestamp) {
        socket.emit('auth-error', { error: 'Missing auth fields' });
        return;
      }
      const expectedMessage = `FutarFi Authentication\nAddress: ${address}\nTimestamp: ${timestamp}`;
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      if (message !== expectedMessage || now - parseInt(timestamp) > fiveMinutes) {
        socket.emit('auth-error', { error: 'Invalid message or expired timestamp' });
        return;
      }
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        socket.emit('auth-error', { error: 'Invalid signature' });
        return;
      }
      socket.data.address = address.toLowerCase();
      socket.join(`user-${socket.data.address}`);
      socket.emit('auth-success', { address: socket.data.address });
      console.log(`Socket ${socket.id} authenticated as ${socket.data.address}`);
    } catch (e) {
      socket.emit('auth-error', { error: 'Auth verification failed' });
    }
  });

  socket.on('join-proposal', (proposalId) => {
    socket.join(`proposal-${proposalId}`);
    console.log(`Socket ${socket.id} joined proposal room: ${proposalId}`);
  });

  socket.on('leave-proposal', (proposalId) => {
    socket.leave(`proposal-${proposalId}`);
    console.log(`Socket ${socket.id} left proposal room: ${proposalId}`);
  });

  socket.on('join-orderbook', (proposalId, side) => {
    socket.join(`orderbook-${proposalId}-${side}`);
    console.log(`Socket ${socket.id} joined orderbook room: ${proposalId}-${side}`);
  });

  socket.on('leave-orderbook', (proposalId, side) => {
    socket.leave(`orderbook-${proposalId}-${side}`);
    console.log(`Socket ${socket.id} left orderbook room: ${proposalId}-${side}`);
  });

  // Allow client to explicitly subscribe to their orders room after auth
  socket.on('subscribe-my-orders', () => {
    if (!socket.data.address) {
      socket.emit('auth-error', { error: 'Authenticate first with auth-wallet' });
      return;
    }
    socket.join(`user-${socket.data.address}`);
    socket.emit('subscribed-my-orders', { address: socket.data.address });
  });

  socket.on('unsubscribe-my-orders', () => {
    if (!socket.data.address) return;
    socket.leave(`user-${socket.data.address}`);
    socket.emit('unsubscribed-my-orders', { address: socket.data.address });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit);

app.use('/api/proposals', proposalsRouter);
app.use('/api/orderbooks', orderbooksRouter);
app.use('/api/auth', authRouter);
app.use('/api/realtime', realtimeRouter);
app.use('/api/auctions', require('./routes/auctions'));
app.use('/api/chain', chainRouter); // read-only info (address, chainId)

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'FutarFi API Documentation'
}));

// Redirect root to API documentation
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the current status of the API server
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);

  // Lightweight internal pollers
  const { startPoll, monitorFilledOrders } = require('./services/chainService');
  const Proposal = require('./models/Proposal');
  const io = app.get('io');

  // Start live ProposalCreated watcher if configured
  if (process.env.PROPOSAL_MANAGER_ADDRESS) {
    const { startProposalCreatedWatcher } = require('./services/chainService');
    try {
      startProposalCreatedWatcher({
        manager: process.env.PROPOSAL_MANAGER_ADDRESS,
        confirmations: Number(process.env.PM_CONFIRMATIONS || 0),
        fromBlock: process.env.PM_START_BLOCK
      });
    } catch (e) {
      console.error('Failed to start ProposalCreated watcher:', e.message);
    }
  }

  // Poll proposals to keep isActive flag fresh
  startPoll('proposals-active', async () => {
    const now = Math.floor(Date.now() / 1000);
    const changed = await Proposal.updateMany({}, [{
      $set: {
        isActive: {
          $and: [
            { $lte: ['$startTime', now] },
            { $gte: ['$endTime', now] },
            { $eq: ['$proposalEnded', false] }
          ]
        }
      }
    }]);
    if (changed?.modifiedCount > 0) {
      const updated = await Proposal.find({});
      updated.forEach(p => {
        const { notifyProposalUpdate } = require('./middleware/websocket');
        notifyProposalUpdate(io, p);
      });
    }
  }, Number(process.env.PROPOSALS_POLL_MS || 15000));

  // Example: internal monitor of filled orders (no HTTP POST). Provide a mapper from Order -> call
  startPoll('filled-orders-monitor', async () => {
    const { monitorFilledOrders } = require('./services/chainService');
    await monitorFilledOrders((order) => {
      // Map DB order -> contract call description
      return null; // implement later as needed
    });
  }, Number(process.env.FILLED_MONITOR_MS || 20000));

  // Auto-sync proposals and auctions from ProposalManager if configured
  if (process.env.PROPOSAL_MANAGER_ADDRESS) {
    const { syncProposalsFromManagerFast } = require('./services/chainService');
    const { notifyProposalUpdate, notifyAuctionUpdate } = require('./middleware/websocket');
    const Auction = require('./models/Auction');

    startPoll('sync-proposals-manager', async () => {
      try {
        const results = await syncProposalsFromManagerFast({ manager: process.env.PROPOSAL_MANAGER_ADDRESS });
        // Broadcast updates for each synced proposal
        for (const r of results) {
          const addr = (r && r.address) ? String(r.address).toLowerCase() : null;
          let doc = null;
          if (addr) doc = await Proposal.findOne({ proposalAddress: addr });
          if (!doc && r.id) doc = await Proposal.findOne({ id: r.id });
          if (!doc) continue;

          // Proposal update
          notifyProposalUpdate(io, doc);

          const pid = String(doc.id);
          // YES auction
          const yes = await Auction.findOne({ proposalId: pid, side: 'yes' });
          if (yes) {
            notifyAuctionUpdate(io, {
              proposalId: pid,
              side: 'yes',
              metrics: {
                currentPrice: yes.currentPrice ?? yes.priceNow(),
                tokensSold: yes.tokensSold,
                maxTokenCap: yes.maxTokenCap ?? yes.cap,
                minTokenCap: yes.minTokenCap ?? yes.minToOpen
              },
              status: {
                finalized: yes.finalized,
                isValid: yes.isValid,
                isCanceled: yes.isCanceled
              }
            });
          }
          // NO auction
          const no = await Auction.findOne({ proposalId: pid, side: 'no' });
          if (no) {
            notifyAuctionUpdate(io, {
              proposalId: pid,
              side: 'no',
              metrics: {
                currentPrice: no.currentPrice ?? no.priceNow(),
                tokensSold: no.tokensSold,
                maxTokenCap: no.maxTokenCap ?? no.cap,
                minTokenCap: no.minTokenCap ?? no.minToOpen
              },
              status: {
                finalized: no.finalized,
                isValid: no.isValid,
                isCanceled: no.isCanceled
              }
            });
          }
        }
      } catch (err) {
        console.error('sync-proposals-manager error:', err.message);
      }
    }, Number(process.env.PROPOSALS_POLL_MS || 15000));
  }

  // Periodically try to finalize eligible Dutch auctions
  if (String(process.env.AUCTION_FINALIZE_ENABLED || 'true').toLowerCase() === 'true') {
    const { monitorAuctionsToFinalize } = require('./services/chainService');
    startPoll('auctions-finalize', async () => {
      try {
        const res = await monitorAuctionsToFinalize();
        if (res.tried || res.finalized) {
          console.log(`auctions-finalize: tried=${res.tried} finalized=${res.finalized}`);
        }
      } catch (e) {
        console.error('auctions-finalize error:', e.message);
      }
    }, Number(process.env.AUCTION_FINALIZE_MS || 30000));
  }

  // Periodically try to resolve proposals whose Live ended
  if (String(process.env.PROPOSAL_RESOLVE_ENABLED || 'true').toLowerCase() === 'true') {
    const { monitorProposalsToResolve } = require('./services/chainService');
    startPoll('proposals-resolve', async () => {
      try {
        const res = await monitorProposalsToResolve();
        if (res.tried || res.resolved) {
          console.log(`proposals-resolve: tried=${res.tried} resolved=${res.resolved}`);
        }
      } catch (e) {
        console.error('proposals-resolve error:', e.message);
      }
    }, Number(process.env.PROPOSAL_RESOLVE_MS || 30000));
  }
});

module.exports = { app, io };
