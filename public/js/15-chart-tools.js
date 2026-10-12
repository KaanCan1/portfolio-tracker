/* 12 Eki 2026: çizim verisi bozulduğunda grafik çökmesin; ileri çapalar yeni mumla kaymasın. */
(function chartTools(root) {
  'use strict';
  const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  function validPoint(p) { return p && positive(p.price) && (typeof p.time === 'string' || (Number.isFinite(p.ext) && p.ext >= 0)); }
  function drawings(items, lastTime) {
    return (Array.isArray(items) ? items : []).filter((i) => i && (i.t === 'h' ? positive(i.price) : i.t === 'trend' && validPoint(i.p1) && validPoint(i.p2))).slice(-200).map((item) => {
      if (item.t === 'h') return { t: 'h', price: item.price };
      const point = (p) => Number.isFinite(p.ext) ? { price: p.price, ext: p.ext, anchor: p.anchor || lastTime } : { price: p.price, time: p.time };
      return { t: 'trend', p1: point(item.p1), p2: point(item.p2) };
    });
  }
  function logical(point, times) {
    const index = times.get(Number.isFinite(point.ext) ? point.anchor : point.time);
    return index == null ? null : index + (Number.isFinite(point.ext) ? point.ext : 0);
  }
  function swingContribution(p, covered) {
    const qty = Math.max(0, Number(p.qty) || 0);
    const counted = p.sayilanQty == null ? Math.max(0, qty - covered) : Math.max(0, Math.min(qty, Number(p.sayilanQty) || 0));
    return { qty: counted, covered: Math.max(0, covered - (qty - counted)), cost: p.sayilanCostUSD ?? (Number(p.entry) || 0) * counted, value: p.sayilanValueUSD ?? (p.valueUSD == null || qty === 0 ? null : p.valueUSD * counted / qty) };
  }
  function cloudParts(a, b) {
    const d1 = a.fast - a.slow, d2 = b.fast - b.slow;
    if (d1 * d2 >= 0) return [{ a, b, bull: (d1 || d2) >= 0 }];
    const t = d1 / (d1 - d2);
    const cross = { x: a.x + (b.x - a.x) * t, fast: a.fast + (b.fast - a.fast) * t, slow: a.slow + (b.slow - a.slow) * t };
    return [{ a, b: cross, bull: d1 > 0 }, { a: cross, b, bull: d2 > 0 }];
  }
  function trendData(line) {
    const points = [line?.p1, line?.p2];
    if (points.some(p => !p || !positive(p.value) || typeof p.time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.time) || !Number.isFinite(Date.parse(p.time)))) return [];
    if (points[0].time === points[1].time) return [];
    return points.map(p => ({time:p.time,value:p.value})).sort((a,b)=>a.time.localeCompare(b.time));
  }
  root.ChartTools = Object.freeze({ drawings, logical, swingContribution, cloudParts, trendData });
})(globalThis);
