const mongoose = require('mongoose');

const auctionSchema = new mongoose.Schema({
  proposalId: { type: String, required: true, ref: 'Proposal' },
  side: { type: String, enum: ['yes', 'no'], required: true },
  auctionAddress: { type: String, required: true },
  marketToken: { type: String, required: true },
  pyusd: { type: String, required: true },
  treasury: { type: String, required: true },
  admin: { type: String, required: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
  priceStart: { type: String, required: true },
  minToOpen: { type: String, required: true },
  cap: { type: String, default: null },
  currentPrice: { type: String, default: null },
  tokensSold: { type: String, default: '0' },
  maxTokenCap: { type: String, default: null },
  minTokenCap: { type: String, default: null },
  finalized: { type: Boolean, default: false },
  isValid: { type: Boolean, default: false },
  isCanceled: { type: Boolean, default: false }
}, { timestamps: true });

auctionSchema.index({ proposalId: 1, side: 1 }, { unique: true });

auctionSchema.methods.priceNow = function() {
  const now = Math.floor(Date.now() / 1000);
  const start = BigInt(this.startTime);
  const end = BigInt(this.endTime);
  const priceStart = BigInt(this.priceStart);
  if (BigInt(now) <= start) return priceStart.toString();
  if (BigInt(now) >= end) return '0';
  const dt = end - start;
  const gone = BigInt(now) - start;
  const diff = priceStart;
  const price = priceStart - (diff * gone) / dt;
  return price.toString();
};

auctionSchema.methods.isLive = function() {
  const nowMs = Date.now();
  return nowMs >= this.startTime * 1000 && nowMs <= this.endTime * 1000 && !this.finalized;
};

module.exports = mongoose.model('Auction', auctionSchema);
