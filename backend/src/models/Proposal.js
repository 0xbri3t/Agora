const mongoose = require('mongoose');
const Counter = require('./Counter');

const proposalSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  // On-chain proposal id (uint256) as string
  proposalContractId: { type: String, required: false, index: true },
  // Proposal contract address
  proposalAddress: { type: String, required: false, index: true },
  admin: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
  duration: { type: Number, required: true },
  subjectToken: { type: String, required: true },
  maxSupply: { type: String, required: true },
  target: { type: String, required: true },
  data: { type: String, required: true },
  marketAddress: { type: String, required: false },
  proposalExecuted: { type: Boolean, default: false },
  proposalEnded: { type: Boolean, default: false },
  // Direct token addresses from getAllProposals struct (new format)
  yesToken: { type: String, required: false },
  noToken: { type: String, required: false },
  yesAuction: { type: String, required: false },
  noAuction: { type: String, required: false },
  treasury: { type: String, required: false },
  minToOpen: { type: String, required: false },
  // On-chain state mirror
  state: {
    type: String,
    enum: ['auction', 'live', 'resolved', 'cancelled'],
    default: 'auction',
    index: true
  },
  isActive: {
    type: Boolean,
    default: function() {
      const now = Date.now() / 1000;
      return now >= this.startTime && now <= this.endTime && !this.proposalEnded;
    }
  },
  auctions: {
    type: new mongoose.Schema({
      yes: {
        type: new mongoose.Schema({
          auctionAddress: String,
          marketToken: String,
          pyusd: String,
          treasury: String,
          admin: String,
          startTime: Number,
          endTime: Number,
          priceStart: String,
          minToOpen: String,
          cap: String,
          currentPrice: String,
          tokensSold: String,
          maxTokenCap: String,
          minTokenCap: String,
          finalized: Boolean,
          isValid: Boolean,
          isCanceled: Boolean
        }, { _id: false }),
        default: null
      },
      no: {
        type: new mongoose.Schema({
          auctionAddress: String,
          marketToken: String,
          pyusd: String,
          treasury: String,
          admin: String,
          startTime: Number,
          endTime: Number,
          priceStart: String,
          minToOpen: String,
          cap: String,
          currentPrice: String,
          tokensSold: String,
          maxTokenCap: String,
          minTokenCap: String,
          finalized: Boolean,
          isValid: Boolean,
          isCanceled: Boolean
        }, { _id: false }),
        default: null
      }
    }, { _id: false }),
    default: null
  }
}, { timestamps: true });

// Virtual token addresses from auctions snapshot
proposalSchema.virtual('approveToken').get(function() {
  return this.auctions && this.auctions.yes ? this.auctions.yes.marketToken || null : null;
});

proposalSchema.virtual('rejectToken').get(function() {
  return this.auctions && this.auctions.no ? this.auctions.no.marketToken || null : null;
});

proposalSchema.set('toJSON', { virtuals: true });

// Check if proposal is active
proposalSchema.methods.checkIsActive = function() {
  const now = Date.now() / 1000;
  return now >= this.startTime && now <= this.endTime && !this.proposalEnded;
};

// Update isActive before saving and auto-increment internal id
proposalSchema.pre('save', async function(next) {
  this.isActive = this.checkIsActive();
  if (this.isNew && (this.id === undefined || this.id === null)) {
    const counter = await Counter.findByIdAndUpdate(
      'proposalId',
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    this.id = counter.seq;
  }
  next();
});

module.exports = mongoose.model('Proposal', proposalSchema);
