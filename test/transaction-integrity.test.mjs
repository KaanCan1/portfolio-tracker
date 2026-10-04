import test from "node:test";
import assert from "node:assert/strict";
import { saleCapacity } from "../sell-inventory.js";
import { validateCashFlow } from "../cash-flow-input.js";

const portfolio = () => ({
  holdings: [{ symbol: "ABC", type: "stock", quantity: 5 }],
  swingTrades: [
    { id: "s1", symbol: "ABC", status: "open", qty: 2 },
    { id: "s2", symbol: "ABC", status: "open", qty: 1 },
  ],
});

test("a sale without a holding can never create cash, even with a swing source", () => {
  const data = { holdings: [], swingTrades: [{ id: "s1", symbol: "ABC", status: "open", qty: 1 }] };
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 1, src: "swing", swingId: "s1" }).ok, false);
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 1, src: "port" }).ok, false);
});

test("normal sales cannot consume swing shares; swing sales cannot consume another swing", () => {
  const data = portfolio();
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 2, src: "port" }).ok, true);
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 3, src: "port" }).ok, false);
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 2, src: "swing", swingId: "s1" }).ok, true);
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 3, src: "swing", swingId: "s1" }).ok, false);
  assert.equal(saleCapacity(data, { symbol: "ABC", shares: 1, src: "swing", swingId: "missing" }).ok, false);
});

test("cash-flow dates and currency are validated before the ledger changes", () => {
  const base = { type: "withdraw", currency: "EUR", amount: 10, amountTRY: 480, date: "2026-02-28" };
  assert.equal(validateCashFlow({ ...base, date: "2026-02-31" }, "2026-10-02").error, "geçerli takvim tarihi zorunlu");
  assert.equal(validateCashFlow({ ...base, currency: "GBP" }, "2026-10-02").error, "para birimi geçersiz");
  assert.equal(validateCashFlow({ ...base, amountTRY: 0 }, "2026-10-02").error, "döviz hareketinde işlem gününün pozitif TL karşılığı zorunlu");
  assert.equal(validateCashFlow({ ...base, amountTRY: undefined }, "2026-10-02").error, "döviz hareketinde işlem gününün pozitif TL karşılığı zorunlu");
  assert.equal(validateCashFlow({ ...base, type: "unknown" }, "2026-10-02").error, "para hareketi türü geçersiz");
});

test("historical foreign flow keeps its entered TL value and does not change today's cash twice", () => {
  const checked = validateCashFlow({ type: "withdraw", currency: "EUR", amount: 10, amountTRY: 480,
    date: "2026-09-20", alreadyReflected: true, note: " Kredi kartı " }, "2026-10-02");
  assert.deepEqual(checked.value, {
    type: "withdraw", currency: "EUR", amount: 10, amountTRY: 480,
    date: "2026-09-20", cashApplied: false, note: "Kredi kartı",
  });
  assert.equal(validateCashFlow({ type: "deposit", currency: "TL", amount: 100, amountTRY: 999,
    date: "2026-10-02" }, "2026-10-02").value.amountTRY, 100);
});
