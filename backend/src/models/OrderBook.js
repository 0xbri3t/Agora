const mongoose = require('mongoose');

const orderBookEntrySchema = new mongoose.Schema({
  price: {
    type: String,
    required: true
  },
  amount: {
    type: String,
    required: true
  },
  orderCount: {
    type: Number,
    default: 1
  }
});

const orderBookSchema = new mongoose.Schema({
  proposalId: {
    type: String,
    required: true,
    ref: 'Proposal'
  },
  side: {
    type: String,
    enum: ['approve', 'reject'],
    required: true
  },
  bids: [orderBookEntrySchema],
  asks: [orderBookEntrySchema],
  lastPrice: {
    type: String,
    default: '0'
  },
  volume24h: {
    type: String,
    default: '0'
  },
  high24h: {
    type: String,
    default: '0'
  },
  low24h: {
    type: String,
    default: '0'
  },
  priceChange24h: {
    type: String,
    default: '0'
  },
  priceChangePercent24h: {
    type: String,
    default: '0'
  },
  twap1h: {
    type: String,
    default: '0'
  },
  twap4h: {
    type: String,
    default: '0'
  },
  twap24h: {
    type: String,
    default: '0'
  },
  twapLastUpdate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

orderBookSchema.index({ proposalId: 1, side: 1 }, { unique: true });

module.exports = mongoose.model('OrderBook', orderBookSchema);
