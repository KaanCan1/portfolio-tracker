// A stock sale must be backed by real, unreserved shares. Swing sales may use
// only their own reservation; neither path may consume another open swing.
export function swingLockedQty(data, symbol, excludeId) {
  const sym = String(symbol || "").toUpperCase();
  return (data.swingTrades || [])
    .filter((s) => s.status === "open" && String(s.symbol).toUpperCase() === sym && s.id !== excludeId)
    .reduce((total, s) => total + (Number(s.qty) || 0), 0);
}

export function saleCapacity(data, trade) {
  const sym = String(trade.symbol || "").toUpperCase();
  const shares = Number(trade.shares);
  const holding = (data.holdings || []).find((h) => h.type === "stock" && String(h.symbol).toUpperCase() === sym);
  const held = Number(holding?.quantity);
  const swing = trade.src === "swing"
    ? (data.swingTrades || []).find((s) => s.id === trade.swingId && s.status === "open" && String(s.symbol).toUpperCase() === sym)
    : null;
  const locked = swingLockedQty(data, sym, trade.src === "swing" ? trade.swingId : undefined);
  const available = Math.max(0, (Number.isFinite(held) ? held : 0) - locked);
  const swingQty = Number(swing?.qty);
  const validSwing = trade.src !== "swing" || (swing && Number.isFinite(swingQty) && shares <= swingQty + 1e-6);
  return {
    ok: !!holding && Number.isFinite(held) && Number.isFinite(shares) && shares > 0 && shares <= available + 1e-6 && !!validSwing,
    available,
    locked,
  };
}
