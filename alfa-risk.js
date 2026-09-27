// Minimum emir tutarı riski artırma izni değildir: 1R bütçeyi aşıyorsa pas.
export function alfaBoyut(entry, stop, sermaye, riskYuzde, minTutar, maxTutar) {
  const fark = entry - stop;
  if (!(entry > 0 && stop > 0 && fark > 0 && sermaye > 0 && riskYuzde > 0)) return 0;
  const tavan = sermaye * riskYuzde / 100;
  const tutar = Math.min(maxTutar, tavan * entry / fark);
  return Number.isFinite(tutar) && tutar >= minTutar ? tutar : 0;
}
