// WebSocket notification helpers
// Note: public per-order broadcasts (new order, status change, match, market data)
// are intentionally NOT emitted for privacy. Only top-of-book, proposal/auction
// updates, and private per-user rooms are used.

const notifyOrderBookUpdate = (io, proposalId, side, orderBook) => {
  try {
    if (!io || !proposalId || !side) return;
    // Emit minimal, privacy-safe top-of-book snapshot to the specific orderbook room
    const bestBid = Array.isArray(orderBook?.bids) && orderBook.bids.length
      ? orderBook.bids[0]
      : null;
    const bestAsk = Array.isArray(orderBook?.asks) && orderBook.asks.length
      ? orderBook.asks[0]
      : null;
    let mid = null;
    if (bestBid && bestAsk) {
      const bid = parseFloat(bestBid.price);
      const ask = parseFloat(bestAsk.price);
      if (Number.isFinite(bid) && Number.isFinite(ask)) mid = ((bid + ask) / 2).toFixed(8);
    }
    io.to(`orderbook-${proposalId}-${side}`).emit('orderbook-top', {
      proposalId: String(proposalId),
      side,
      bestBid,
      bestAsk,
      mid,
      timestamp: new Date().toISOString(),
    });
  } catch (_) {
    // ignore
  }
};

const notifyProposalUpdate = (io, proposal) => {
  // Keep proposal updates (no orderbook data included)
  io.to(`proposal-${proposal.id}`).emit('proposal-update', {
    proposal,
    timestamp: new Date().toISOString()
  });
};

const notifyAuctionUpdate = (io, payload) => {
  if (!io || !payload || !payload.proposalId) return;
  const { proposalId } = payload;
  io.to(`proposal-${proposalId}`).emit('auction-update', {
    ...payload,
    timestamp: new Date().toISOString()
  });
};

const notifyUserOrdersUpdate = (io, userAddress, payload = {}) => {
  if (!io || !userAddress) return;
  const address = userAddress.toLowerCase();
  io.to(`user-${address}`).emit('my-orders-updated', {
    address,
    reason: payload.reason || 'orderbook-change',
    changedOrderId: payload.changedOrderId || null,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  notifyOrderBookUpdate,
  notifyProposalUpdate,
  notifyAuctionUpdate,
  notifyUserOrdersUpdate
};
