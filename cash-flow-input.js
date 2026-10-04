// Cash flows are external capital movements. A malformed amount or rate must
// never enter the ledger because performance uses this record as its source.
export function validateCashFlow(input, today) {
  const f = input && typeof input === "object" ? input : {};
  const amount = Number(f.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: "pozitif tutar zorunlu" };
  if (!["deposit", "withdraw"].includes(f.type)) return { error: "para hareketi türü geçersiz" };
  if (!["TL", "USD", "EUR"].includes(f.currency)) return { error: "para birimi geçersiz" };

  const date = f.date || today;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { error: "geçerli takvim tarihi zorunlu" };
  }

  const amountTRY = f.currency === "TL" ? amount : Number(f.amountTRY);
  if (!(amountTRY > 0) || !Number.isFinite(amountTRY)) {
    return { error: "döviz hareketinde işlem gününün pozitif TL karşılığı zorunlu" };
  }

  return {
    value: {
      type: f.type,
      date,
      currency: f.currency,
      amount,
      amountTRY,
      cashApplied: !(f.alreadyReflected === true && date < today),
      note: typeof f.note === "string" ? f.note.trim().slice(0, 500) : "",
    },
  };
}
