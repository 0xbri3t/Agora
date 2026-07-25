import { Bytes, BigInt, crypto, ethereum, ByteArray } from "@graphprotocol/graph-ts";
import { Docked, Shipped } from "../generated/Aqua/Aqua";
import { Market, OpenLotIndex, Quote } from "../generated/schema";
import { getOrCreateMaker, lotPrice, openLotIndexId, ROUTER_ADDRESS } from "./helpers";

// ship(address app, bytes strategy, address[] tokens, uint256[] amounts)
const SHIP_SIGNATURE = "ship(address,bytes,address[],uint256[])";

export function handleShipped(event: Shipped): void {
  // Aqua is shared infrastructure — only strategies shipped to our router matter.
  if (event.params.app.toHexString() != ROUTER_ADDRESS) return;

  // The event carries the strategy but not the shipped balances; those are the
  // ship() calldata token/amount arrays (the lot's price and size), so decode
  // the transaction input. Direct EOA calls only — batched calls are skipped.
  const input = event.transaction.input;
  if (input.length < 4) return;
  const selector = Bytes.fromUint8Array(
    crypto.keccak256(ByteArray.fromUTF8(SHIP_SIGNATURE)).subarray(0, 4)
  );
  if (Bytes.fromUint8Array(input.subarray(0, 4)) != selector) return;

  // Calldata args have no outer tuple offset word, but ethereum.decode expects
  // the abi.encode(tuple) form — prepend the standard 0x20 offset to bridge.
  const payload = Bytes.fromHexString(
    "0x0000000000000000000000000000000000000000000000000000000000000020"
  ).concat(Bytes.fromUint8Array(input.subarray(4)));
  const decoded = ethereum.decode("(address,bytes,address[],uint256[])", payload);
  if (decoded == null) return;
  const args = decoded.toTuple();
  const tokens = args[2].toAddressArray();
  const amounts = args[3].toBigIntArray();
  if (tokens.length != 2 || amounts.length != 2) return;

  // One shipped token is the outcome token (has a Market), the other is USDC.
  let market: Market | null = null;
  let lotUsdc = BigInt.zero();
  let lotToken = BigInt.zero();
  for (let i = 0; i < 2; i++) {
    const candidate = Market.load(tokens[i].toHexString());
    if (candidate != null) {
      market = candidate;
      lotToken = amounts[i];
      lotUsdc = amounts[1 - i];
    }
  }
  if (market == null) return;

  const maker = getOrCreateMaker(event.params.maker);

  const quote = new Quote(event.params.strategyHash.toHexString());
  quote.market = market.id;
  quote.maker = maker.id;
  quote.lotUsdc = lotUsdc;
  quote.lotToken = lotToken;
  quote.price = lotPrice(lotUsdc, lotToken);
  quote.status = "OPEN";
  quote.createdAt = event.block.timestamp;
  quote.updatedAt = event.block.timestamp;
  quote.txHash = event.transaction.hash;
  quote.save();

  maker.quoteCount = maker.quoteCount + 1;
  maker.save();

  market.openQuoteCount = market.openQuoteCount + 1;
  market.save();

  // FIFO bucket so a fill (which only knows maker + exact amounts) finds its quote.
  const indexId = openLotIndexId(event.params.maker, market.id, lotUsdc, lotToken);
  let index = OpenLotIndex.load(indexId);
  if (index == null) {
    index = new OpenLotIndex(indexId);
    index.quoteIds = [];
  }
  const ids = index.quoteIds;
  ids.push(quote.id);
  index.quoteIds = ids;
  index.save();
}

export function handleDocked(event: Docked): void {
  const quote = Quote.load(event.params.strategyHash.toHexString());
  if (quote == null || quote.status != "OPEN") return;

  quote.status = "CANCELLED";
  quote.updatedAt = event.block.timestamp;
  quote.save();

  const market = Market.load(quote.market);
  if (market != null) {
    market.openQuoteCount = market.openQuoteCount - 1;
    market.save();

    const indexId = openLotIndexId(
      event.params.maker,
      market.id,
      quote.lotUsdc,
      quote.lotToken
    );
    const index = OpenLotIndex.load(indexId);
    if (index != null) {
      const ids = index.quoteIds;
      const position = ids.indexOf(quote.id);
      if (position >= 0) {
        ids.splice(position, 1);
        index.quoteIds = ids;
        index.save();
      }
    }
  }
}
