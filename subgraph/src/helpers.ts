import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Maker } from "../generated/schema";

// LimitSwapVMRouter on Sepolia — only Aqua strategies shipped to this app are ours.
export const ROUTER_ADDRESS = "0x4cf2713d08c5e439409b56efa4027f25eb0f6431";

export const WAD = BigInt.fromString("1000000000000000000");

/** USDC (6d) per 1e18 outcome token. */
export function lotPrice(lotUsdc: BigInt, lotToken: BigInt): BigInt {
  if (lotToken.isZero()) return BigInt.zero();
  return lotUsdc.times(WAD).div(lotToken);
}

export function getOrCreateMaker(address: Address): Maker {
  const id = address.toHexString();
  let maker = Maker.load(id);
  if (maker == null) {
    maker = new Maker(id);
    maker.quoteCount = 0;
    maker.fillCount = 0;
    maker.volumeUsdc = BigInt.zero();
    maker.save();
  }
  return maker;
}

/** FIFO bucket key for identical open lots — lets a FOK fill find its quote. */
export function openLotIndexId(
  maker: Address,
  marketId: string,
  lotUsdc: BigInt,
  lotToken: BigInt
): string {
  return (
    maker.toHexString() + "-" + marketId + "-" + lotUsdc.toString() + "-" + lotToken.toString()
  );
}
