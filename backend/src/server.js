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
const auctionsRouter = require('./routes/auctions');
const chainRouter = require('./routes/chain');
const rateLimit = require('./middleware/rateLimit');
const { verifySignedMessage } = require('./middleware/walletAuth');
const { notifyProposalUpdate, notifyAuctionUpdate } = require('./middleware/websocket');

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

const SOCKET_AUTH_TTL_MS = 5 * 60 * 1000;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Client must authenticate once per connection with signed message
  socket.on('auth-wallet', ({ address, signature, message, timestamp }) => {
    try {
      const result = verifySignedMessage({ address, signature, message, timestamp, ttlMs: SOCKET_AUTH_TTL_MS });
      if (!result.ok) {
        socket.emit('auth-error', { error: result.error });
        return;
      }
      socket.data.address = result.address;
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
app.use('/api/auctions', auctionsRouter);
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
  const {
    startPoll,
    startProposalCreatedWatcher,
    syncProposalsFromManagerFast,
    monitorAuctionsToFinalize,
    monitorProposalsToResolve
  } = require('./services/chainService');
  const Proposal = require('./models/Proposal');
  const Auction = require('./models/Auction');

  // Aqua/SwapVM order-book bridge — trading settles on 1inch Aqua; we index it
  try {
    const { startAquaListener } = require('./services/aquaOrderbookService');
    const { getProvider, getSigner } = require('./config/ethers');
    startAquaListener({ provider: getProvider() });
    console.log('Aqua order-book listener started');

    // Attestor pushes volume-weighted TWAPs from Aqua fills for resolution
    const attestor = getSigner();
    if (attestor) {
      const { startTwapPusher } = require('./services/twapPusherService');
      startTwapPusher({ provider: getProvider(), signer: attestor });
      console.log('TWAP pusher started');
    } else {
      console.warn('No PRIVATE_KEY set — TWAP pusher disabled (resolution needs it)');
    }
  } catch (e) {
    console.error('Failed to start Aqua listener:', e.message);
  }

  // Start live ProposalCreated watcher if configured
  if (process.env.PROPOSAL_MANAGER_ADDRESS) {
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
      updated.forEach(p => notifyProposalUpdate(io, p));
    }
  }, Number(process.env.PROPOSALS_POLL_MS || 15000));

  // Auto-sync proposals and auctions from ProposalManager if configured
  if (process.env.PROPOSAL_MANAGER_ADDRESS) {
    const broadcastAuction = (auction) => {
      if (!auction) return;
      notifyAuctionUpdate(io, {
        proposalId: auction.proposalId,
        side: auction.side,
        metrics: {
          currentPrice: auction.currentPrice ?? auction.priceNow(),
          tokensSold: auction.tokensSold,
          maxTokenCap: auction.maxTokenCap ?? auction.cap,
          minTokenCap: auction.minTokenCap ?? auction.minToOpen
        },
        status: {
          finalized: auction.finalized,
          isValid: auction.isValid,
          isCanceled: auction.isCanceled
        }
      });
    };

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

          notifyProposalUpdate(io, doc);

          const pid = String(doc.id);
          const [yes, no] = await Promise.all([
            Auction.findOne({ proposalId: pid, side: 'yes' }),
            Auction.findOne({ proposalId: pid, side: 'no' })
          ]);
          broadcastAuction(yes);
          broadcastAuction(no);
        }
      } catch (err) {
        console.error('sync-proposals-manager error:', err.message);
      }
    }, Number(process.env.PROPOSALS_POLL_MS || 15000));
  }

  // Periodically try to finalize eligible Dutch auctions
  if (String(process.env.AUCTION_FINALIZE_ENABLED || 'true').toLowerCase() === 'true') {
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
