import { expect, test } from "bun:test";
import { displayOrderFor, matchOrders } from "./content";
import { matchItem, sortItem } from "./test-fixtures";

test("a match display order shuffles both sides and never puts a pair's entries at one position", () => {
  const item = matchItem();
  for (let run = 0; run < 200; run++) {
    const { left, right } = matchOrders(item, displayOrderFor(item)!);
    expect(left.slice().sort()).toEqual([0, 1, 2]);
    expect(right.slice().sort()).toEqual([0, 1, 2, 3]);
    left.forEach((pair, d) => expect(right[d]).not.toBe(pair));
  }
});

test("a sort display order is a permutation of its entries", () => {
  expect(displayOrderFor(sortItem())!.slice().sort()).toEqual([0, 1, 2, 3]);
});
