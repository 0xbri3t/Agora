import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ByteArray, crypto, ethereum } from "@graphprotocol/graph-ts";
import { Market } from "../generated/schema";
import { Shipped, Docked } from "../generated/Aqua/Aqua";
import { Swapped } from "../generated/LimitSwapVMRouter/LimitSwapVMRouter";
import { handleShipped, handleDocked } from "../src/aqua";
import { handleSwapped } from "../src/router";
import { ROUTER_ADDRESS } from "../src/helpers";

const MAKER = Address.fromString("0x00000000000000000000000000000000000000a1");
const TAKER = Address.fromString("0x00000000000000000000000000000000000000b2");
const USDC = Address.fromString("0x34ad23a27ae8a562928234d4415ed7225a44bb2e");
const YES_TOKEN = Address.fromString("0x00000000000000000000000000000000000000c3");
const ROUTER = Address.fromString(ROUTER_ADDRESS);
const STRATEGY_HASH = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
) as Bytes;

const LOT_USDC = BigInt.fromI32(600000); // 0.60 USDC
const LOT_TOKEN = BigInt.fromString("1000000000000000000"); // 1 token

function seedYesMarket(): void {
  const market = new Market(YES_TOKEN.toHexString());
  market.proposal = "0x00000000000000000000000000000000000000d4";
  market.side = "YES";
  market.token = YES_TOKEN;
  market.volumeUsdc = BigInt.zero();
  market.fillCount = 0;
  market.openQuoteCount = 0;
  market.save();
}

/** abi-encoded ship(app, strategy, tokens, amounts) calldata, selector included. */
function shipCalldata(): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromAddress(ROUTER),
        ethereum.Value.fromBytes(Bytes.fromHexString("0xdead") as Bytes),
        ethereum.Value.fromAddressArray([USDC, YES_TOKEN]),
        ethereum.Value.fromUnsignedBigIntArray([LOT_USDC, LOT_TOKEN]),
      ])
    )
  )!;
  const selector = crypto
    .keccak256(ByteArray.fromUTF8("ship(address,bytes,address[],uint256[])"))
    .subarray(0, 4);
  return Bytes.fromUint8Array(selector).concat(
    Bytes.fromUint8Array(encoded.subarray(32)) // drop the outer tuple offset word
  );
}

function mockShipped(app: Address): Shipped {
  const base = newMockEvent();
  const event = new Shipped(
    base.address,
    base.logIndex,
    base.transactionLogIndex,
    base.logType,
    base.block,
    base.transaction,
    base.parameters,
    base.receipt
  );
  event.transaction.input = shipCalldata();
  event.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(MAKER)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(app)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(STRATEGY_HASH)),
    new ethereum.EventParam("strategy", ethereum.Value.fromBytes(Bytes.fromHexString("0xdead") as Bytes)),
  ];
  return event;
}

function mockDocked(): Docked {
  const base = newMockEvent();
  const event = new Docked(
    base.address,
    base.logIndex,
    base.transactionLogIndex,
    base.logType,
    base.block,
    base.transaction,
    base.parameters,
    base.receipt
  );
  event.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(MAKER)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(ROUTER)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(STRATEGY_HASH)),
  ];
  return event;
}

function mockSwapped(): Swapped {
  const base = newMockEvent();
  const event = new Swapped(
    base.address,
    base.logIndex,
    base.transactionLogIndex,
    base.logType,
    base.block,
    base.transaction,
    base.parameters,
    base.receipt
  );
  event.parameters = [
    new ethereum.EventParam(
      "orderHash",
      ethereum.Value.fromFixedBytes(
        Bytes.fromHexString("0x2222222222222222222222222222222222222222222222222222222222222222") as Bytes
      )
    ),
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(MAKER)),
    new ethereum.EventParam("taker", ethereum.Value.fromAddress(TAKER)),
    new ethereum.EventParam("tokenIn", ethereum.Value.fromAddress(USDC)),
    new ethereum.EventParam("tokenOut", ethereum.Value.fromAddress(YES_TOKEN)),
    new ethereum.EventParam("amountIn", ethereum.Value.fromUnsignedBigInt(LOT_USDC)),
    new ethereum.EventParam("amountOut", ethereum.Value.fromUnsignedBigInt(LOT_TOKEN)),
  ];
  return event;
}

describe("Aqua lot indexing", () => {
  beforeEach(() => {
    clearStore();
    seedYesMarket();
  });

  test("Shipped creates an OPEN quote with price decoded from ship calldata", () => {
    handleShipped(mockShipped(ROUTER));

    const id = STRATEGY_HASH.toHexString();
    assert.entityCount("Quote", 1);
    assert.fieldEquals("Quote", id, "status", "OPEN");
    assert.fieldEquals("Quote", id, "lotUsdc", "600000");
    assert.fieldEquals("Quote", id, "lotToken", "1000000000000000000");
    assert.fieldEquals("Quote", id, "price", "600000");
    assert.fieldEquals("Market", YES_TOKEN.toHexString(), "openQuoteCount", "1");
    assert.fieldEquals("Maker", MAKER.toHexString(), "quoteCount", "1");
  });

  test("Shipped to a foreign app is ignored", () => {
    handleShipped(mockShipped(Address.fromString("0x00000000000000000000000000000000000000ee")));
    assert.entityCount("Quote", 0);
  });

  test("Swapped fills the matching FOK quote and rolls up market volume", () => {
    handleShipped(mockShipped(ROUTER));
    handleSwapped(mockSwapped());

    const id = STRATEGY_HASH.toHexString();
    assert.fieldEquals("Quote", id, "status", "FILLED");
    assert.entityCount("Fill", 1);
    assert.fieldEquals("Market", YES_TOKEN.toHexString(), "volumeUsdc", "600000");
    assert.fieldEquals("Market", YES_TOKEN.toHexString(), "lastPrice", "600000");
    assert.fieldEquals("Market", YES_TOKEN.toHexString(), "openQuoteCount", "0");
    assert.fieldEquals("Maker", MAKER.toHexString(), "volumeUsdc", "600000");
  });

  test("Docked cancels an open quote", () => {
    handleShipped(mockShipped(ROUTER));
    handleDocked(mockDocked());

    assert.fieldEquals("Quote", STRATEGY_HASH.toHexString(), "status", "CANCELLED");
    assert.fieldEquals("Market", YES_TOKEN.toHexString(), "openQuoteCount", "0");
  });

  test("Swapped on an unknown token pair is ignored", () => {
    const event = mockSwapped();
    event.parameters[4] = new ethereum.EventParam(
      "tokenOut",
      ethereum.Value.fromAddress(Address.fromString("0x00000000000000000000000000000000000000ff"))
    );
    event.parameters[3] = new ethereum.EventParam(
      "tokenIn",
      ethereum.Value.fromAddress(Address.fromString("0x00000000000000000000000000000000000000fe"))
    );
    handleSwapped(event);
    assert.entityCount("Fill", 0);
  });
});
