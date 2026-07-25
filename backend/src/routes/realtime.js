const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const OrderBook = require('../models/OrderBook');
const Proposal = require('../models/Proposal');

const { validateOrder } = require('../middleware/validation');

/**
 * @swagger
 * tags:
 *   name: Realtime
 *   description: Real-time data and monitoring endpoints
 */

/**
 * @swagger
 * /api/realtime/dashboard:
 *   get:
 *     summary: Get real-time dashboard data
 *     tags: [Realtime]
 *     responses:
 *       200:
 *         description: Dashboard data with active proposals, recent orders, and statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeProposals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Proposal'
 *                 recentOrders:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Order'
 *                 topVolumeProposals:
 *                   type: array
 *                   items:
 *                     type: object
 *                 systemStats:
 *                   type: object
 *                 recentTrades:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
router.get('/dashboard', async (req, res) => {
  try {
    const activeProposals = await Proposal.find({ isActive: true });

    const recentOrders = await Order.find({
      createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
    }).sort({ createdAt: -1 }).limit(10);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const volumeData = await Order.aggregate([
      {
        $match: {
          updatedAt: { $gte: yesterday },
          filledAmount: { $gt: '0' }
        }
      },
      {
        $group: {
          _id: '$proposalId',
          totalVolume: { 
            $sum: { $toDecimal: '$filledAmount' }
          },
          tradeCount: { $sum: 1 }
        }
      },
      {
        $sort: { totalVolume: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Get system statistics
    const totalOrders = await Order.countDocuments();
    const totalProposals = await Proposal.countDocuments();
    const activeOrdersCount = await Order.countDocuments({ status: { $in: ['open', 'partial'] } });
    
    // Get recent matches/trades
    const recentTrades = await Order.find({
      filledAmount: { $gt: '0' },
      updatedAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
    })
    .sort({ updatedAt: -1 })
    .limit(10)
    .select('proposalId side orderType price filledAmount updatedAt');

    res.json({
      activeProposals,
      recentOrders: recentOrders.map(order => ({
        id: order._id,
        proposalId: order.proposalId,
        side: order.side,
        orderType: order.orderType,
        orderExecution: order.orderExecution,
        price: order.price,
        amount: order.amount,
        status: order.status,
        createdAt: order.createdAt
      })),
      topVolumeProposals: volumeData,
      recentTrades: recentTrades.map(trade => ({
        proposalId: trade.proposalId,
        side: trade.side,
        type: trade.orderType,
        price: trade.price,
        amount: trade.filledAmount,
        timestamp: trade.updatedAt
      })),
      statistics: {
        totalOrders,
        totalProposals,
        activeOrders: activeOrdersCount,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/realtime/health:
 *   get:
 *     summary: Get system health and metrics
 *     tags: [Realtime]
 *     responses:
 *       200:
 *         description: System health status and recent activity metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 database:
 *                   type: object
 *                 recentActivity:
 *                   type: object
 *                 uptime:
 *                   type: number
 *                 memoryUsage:
 *                   type: object
 *       500:
 *         description: Server error
 */
router.get('/health', async (req, res) => {
  try {
    const dbStatus = await Order.db.db.admin().ping();
    
    // Get recent activity metrics
    const last5Minutes = new Date(Date.now() - 5 * 60 * 1000);
    const recentActivity = {
      newOrders: await Order.countDocuments({ createdAt: { $gte: last5Minutes } }),
      filledOrders: await Order.countDocuments({ 
        updatedAt: { $gte: last5Minutes },
        filledAmount: { $gt: '0' }
      }),
      cancelledOrders: await Order.countDocuments({
        updatedAt: { $gte: last5Minutes },
        status: 'cancelled'
      })
    };

    res.json({
      status: 'healthy',
      database: dbStatus ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      recentActivity,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/market-overview', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    const timeframeMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }[timeframe] || 24 * 60 * 60 * 1000;

    const startTime = new Date(Date.now() - timeframeMs);

    // Get volume by proposal
    const volumeByProposal = await Order.aggregate([
      {
        $match: {
          updatedAt: { $gte: startTime },
          filledAmount: { $gt: '0' }
        }
      },
      {
        $group: {
          _id: { proposalId: '$proposalId', side: '$side' },
          volume: { $sum: { $toDecimal: '$filledAmount' } },
          tradeCount: { $sum: 1 },
          avgPrice: { $avg: { $toDecimal: '$price' } }
        }
      }
    ]);

    // Get price ranges
    const priceRanges = await Order.aggregate([
      {
        $match: {
          updatedAt: { $gte: startTime },
          filledAmount: { $gt: '0' }
        }
      },
      {
        $group: {
          _id: { proposalId: '$proposalId', side: '$side' },
          minPrice: { $min: { $toDecimal: '$price' } },
          maxPrice: { $max: { $toDecimal: '$price' } },
          firstPrice: { $first: { $toDecimal: '$price' } },
          lastPrice: { $last: { $toDecimal: '$price' } }
        }
      }
    ]);

    // Get active order counts
    const activeOrderCounts = await Order.aggregate([
      {
        $match: {
          status: { $in: ['open', 'partial'] }
        }
      },
      {
        $group: {
          _id: { proposalId: '$proposalId', side: '$side' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      timeframe,
      volumeByProposal,
      priceRanges,
      activeOrderCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection info endpoint
router.get('/websocket-info', (req, res) => {
  const io = req.app.get('io');
  
  if (!io) {
    return res.status(500).json({ error: 'WebSocket server not available' });
  }

  const connectedClients = io.engine.clientsCount;
  const rooms = Array.from(io.sockets.adapter.rooms.keys())
    .filter(room => room.startsWith('proposal-') || room.startsWith('orderbook-'));

  res.json({
    status: 'active',
    connectedClients,
    activeRooms: rooms.length,
    rooms: rooms.slice(0, 20), // Limit to first 20 rooms for performance
    events: [
      'new-order',
      'order-status-change',
      'order-matched',
      'orderbook-update',
      'market-data',
      'proposal-update',
      'new-proposal'
    ],
    instructions: {
      connect: 'Connect to the WebSocket server using Socket.IO client',
      joinProposal: 'Emit "join-proposal" with proposalId to get proposal updates',
      joinOrderbook: 'Emit "join-orderbook" with proposalId and side to get orderbook updates',
      events: 'Listen for the events listed above to receive real-time updates'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
