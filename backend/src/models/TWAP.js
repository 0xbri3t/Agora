const mongoose = require('mongoose');

const twapSchema = new mongoose.Schema({
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
  timeframe: {
    type: String,
    enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M', 'all'],
    required: true
  },
  twapPrice: {
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
  },
  pricePoints: [{
    price: String,
    amount: String,
    timestamp: Date
  }]
}, {
  timestamps: true
});

twapSchema.index({ proposalId: 1, side: 1, timeframe: 1 });
twapSchema.index({ timestamp: 1 });

module.exports = mongoose.model('TWAP', twapSchema);
