const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  proposalId: {
    type: String,
    required: true
  },
  side: {
    type: String,
    enum: ['approve', 'reject'],
    required: true
  },
  orderType: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  orderExecution: {
    type: String,
    enum: ['limit', 'market'],
    required: true,
    default: 'limit'
  },
  price: {
    type: String,
    required: function() {
      return this.orderExecution === 'limit';
    }
  },
  amount: {
    type: String,
    required: true
  },
  filledAmount: {
    type: String,
    default: '0'
  },
  slippage: {
    type: String,
    default: null // Informational only
  },
  executedPrice: {
    type: String,
    default: null // Weighted average execution price
  },
  fills: [{
    price: String,
    amount: String,
    timestamp: Date,
    matchedOrderId: String,
    txHash: String,
    timestampExecuted: Date,
    isExecuted: Boolean
  }],

  userAddress: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'filled', 'cancelled', 'partial'],
    default: 'open'
  },
  txHash: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

orderSchema.index({ proposalId: 1, side: 1, price: 1 });
orderSchema.index({ userAddress: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ orderExecution: 1 });
orderSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Order', orderSchema);
