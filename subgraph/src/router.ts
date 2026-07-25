import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Swapped } from "../generated/LimitSwapVMRouter/LimitSwapVMRouter";
import { Fill, Market, OpenLotIndex, Quote } from "../generated/schema";
import { getOrCreateMaker, lotPrice, openLotIndexId } from "./helpers";

export function handleSwapped(event: Swapped): void {
  // Takers buy outcome tokens with USDC (tokenOut = outcome). Makers buying
  // back (tokenIn = outcome) is handled too, for completeness.
  let market = Market.load(event.params.tokenOut.toHexString());
  let amountToken = event.params.amountOut;
  let amountUsdc = event.params.amountIn;
  if (market == null) {
    market = Market.load(event.params.tokenIn.toHexString());
    amountToken = event.params.amountIn;
    amountUsdc = event.params.amountOut;
  }
  if (market == null) return; // not one of our outcome-token markets

  const maker = getOrCreateMaker(event.params.maker);

  const fill = new Fill(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  fill.market = market.id;
  fill.maker = maker.id;
  fill.taker = event.params.taker;
  fill.amountUsdc = amountUsdc;
  fill.amountToken = amountToken;
  fill.price = lotPrice(amountUsdc, amountToken);
  fill.timestamp = event.block.timestamp;
  fill.txHash = event.transaction.hash;

  // Lots are fill-or-kill, so the fill amounts equal the shipped lot exactly —
  // pop the oldest open quote from the matching FIFO bucket.
  const indexId = openLotIndexId(
    Address.fromBytes(event.params.maker),
    market.id,
    amountUsdc,
    amountToken
  );
  const index = OpenLotIndex.load(indexId);
  if (index != null && index.quoteIds.length > 0) {
    const ids = index.quoteIds;
    const quoteId = ids.shift();
    index.quoteIds = ids;
    index.save();

    const quote = Quote.load(quoteId);
    if (quote != null && quote.status == "OPEN") {
      quote.status = "FILLED";
      quote.updatedAt = event.block.timestamp;
      quote.fill = fill.id;
      quote.save();
      fill.quote = quote.id;

      market.openQuoteCount = market.openQuoteCount - 1;
    }
  }

  fill.save();

  market.volumeUsdc = market.volumeUsdc.plus(amountUsdc);
  market.fillCount = market.fillCount + 1;
  market.lastPrice = fill.price;
  market.lastFillAt = event.block.timestamp;
  market.save();

  maker.fillCount = maker.fillCount + 1;
  maker.volumeUsdc = maker.volumeUsdc.plus(amountUsdc);
  maker.save();
}
