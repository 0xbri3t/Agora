const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
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
  price: {
    type: String,
    required: true
  },
  volume: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient TWAP queries
priceHistorySchema.index({ proposalId: 1, side: 1, timestamp: -1 });
priceHistorySchema.index({ timestamp: 1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
