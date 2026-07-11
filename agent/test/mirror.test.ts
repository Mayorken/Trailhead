import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeMirroredTrade, computeMinAmountOut } from "../src/mirror.js";

test("sizeMirroredTrade mirrors the strategy's fraction onto the follower", () => {
  // Strategy spent 20% of its holding; follower has 500 -> 100.
  assert.equal(sizeMirroredTrade(200n, 1000n, 500n), 100n);
});

test("sizeMirroredTrade caps at the follower's available balance", () => {
  // Strategy spent its entire holding (100%); follower only has 300.
  assert.equal(sizeMirroredTrade(1000n, 1000n, 300n), 300n);
});

test("sizeMirroredTrade clamps a strategy overspend to 100%", () => {
  // amountIn > balanceBefore shouldn't push the follower above their whole balance.
  assert.equal(sizeMirroredTrade(2000n, 1000n, 400n), 400n);
});

test("sizeMirroredTrade returns 0 on degenerate inputs", () => {
  assert.equal(sizeMirroredTrade(0n, 1000n, 500n), 0n);
  assert.equal(sizeMirroredTrade(200n, 0n, 500n), 0n);
  assert.equal(sizeMirroredTrade(200n, 1000n, 0n), 0n);
});

test("sizeMirroredTrade floors on integer division", () => {
  // 333/1000 of 10 = 3.33 -> 3
  assert.equal(sizeMirroredTrade(333n, 1000n, 10n), 3n);
});

test("computeMinAmountOut applies slippage in bps", () => {
  assert.equal(computeMinAmountOut(1000n, 300n), 970n); // 3%
  assert.equal(computeMinAmountOut(1000n, 0n), 1000n); // no slippage tolerated
  assert.equal(computeMinAmountOut(0n, 300n), 0n);
});
