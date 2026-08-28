/* 06-analiz.js — Analiz görünümü · ısı haritası/sektör · Profesyonel Risk Masası · Risk & Performans Karnesi · pozisyon teknikleri
 * app.js'in SIRALI dilimi (bölme: 15 Tem 2026). Dosyalar index.html'deki sırayla yüklenir;
 * klasik script'ler global kapsamı paylaşır — sıra değiştirme, dosyayı IIFE'ye sarma. */
/* ============================ Görünüm: Analiz ============================ */
// Günlük değişimi diverging kırmızı↔gri↔yeşil skalaya çevirir (±%4 doygunluk).
// Koyu kutularda beyaz, açık kutularda koyu yazı → her zaman okunur.
function heatStyle(pct) {
  if (pct == null || isNaN(pct)) return { bg: "hsl(140 6% 91%)", fg: "#5a655d" };
  const t = Math.max(-1, Math.min(1, pct / 4));
  const mag = Math.abs(t);
  const hue = t >= 0 ? 146 : 6;
  const sat = 14 + mag * 54;     // 14%..68%
  const light = 93 - mag * 44;   // 93%..49%
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, fg: light < 64 ? "#ffffff" : "#1d2722" };
}

// Basit squarified treemap: items[{value,...}] (desc) → her birine {x,y,w,h} (%)
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const area = w * h;
  const sc = items.map((i) => ({ ...i, area: (i.value / total) * area }));
  const out = [];
  let rx = x, ry = y, rw = w, rh = h, i = 0;
  while (i < sc.length) {
    const vertical = rw >= rh;
    const side = vertical ? rh : rw;
    let row = [], rowArea = 0, best = Infinity, j = i;
    for (; j < sc.length; j++) {
      const ta = rowArea + sc[j].area;
      const len = ta / side;
      const worst = [...row, sc[j]].reduce((m, t) => {
        const thick = t.area / len;
        return Math.max(m, Math.max(len / thick, thick / len));
      }, 0);
      if (worst > best && row.length) break;
      best = worst; row = [...row, sc[j]]; rowArea = ta;
    }
    const len = rowArea / side;
    let off = 0;
    for (const t of row) {
      const thick = t.area / len;
      if (vertical) { out.push({ ...t, x: rx, y: ry + off, w: len, h: thick }); off += thick; }
      else { out.push({ ...t, x: rx + off, y: ry, w: thick, h: len }); off += thick; }
    }
    if (vertical) { rx += len; rw -= len; } else { ry += len; rh -= len; }
    i = j; best = Infinity;
  }
  return out;
}

function renderHeatmap() {
  const el = $("#heatmap"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock" && h.live?.marketValueTRY > 0);
  if (!stocks.length) {
    el.innerHTML = `<div class="radar-empty">Hisse pozisyonu yok ya da fiyatlar yenileniyor.</div>`;
    return;
  }
  const total = stocks.reduce((s, h) => s + h.live.marketValueTRY, 0);
  const items = stocks.map((h) => ({
    id: h.id, symbol: h.symbol, value: h.live.marketValueTRY,
    pct: h.live.dayChangePct, mv: h.live.marketValueTRY,
    share: (h.live.marketValueTRY / total) * 100,
    usd: h.live.marketValueUSD ?? null,
  })).sort((a, b) => b.value - a.value);
  const tiles = squarify(items, 0, 0, 100, 100);
  el.innerHTML = `<div class="hm-canvas">${tiles.map((t) => {
    const { bg, fg } = heatStyle(t.pct);
    const area = t.w * t.h;            // %² — yazı yoğunluğunu kutu boyutuna göre ayarla
    const showPct = area >= 60 && t.h >= 7;
    const showVal = area >= 220 && t.h >= 12;
    return `<div class="hm-tile" data-pos="${t.id}"
      title="${t.symbol} · ${fmtTRY0(t.mv)} (%${t.share.toFixed(1)}) · gün ${fmtPct(t.pct)}"
      style="left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;background:${bg};color:${fg}">
      <span class="hm-sym">${t.symbol}</span>
      ${showPct ? `<span class="hm-pct">${t.pct != null ? fmtPct(t.pct) : "—"}</span>` : ""}
      ${showVal ? `<span class="hm-val">${fmtTRY0(t.mv)}</span>` : ""}
    </div>`;
  }).join("")}</div>
  <div class="hm-legend">
    <span class="hm-leg-lbl">Günlük</span>
    <span class="hm-leg-scale">
      ${[-4, -2, 0, 2, 4].map((p) => `<i style="background:${heatStyle(p).bg}"></i>`).join("")}
    </span>
    <span class="hm-leg-ends"><b>−%4</b><b>+%4</b></span>
  </div>`;
  el.querySelectorAll("[data-pos]").forEach((b) =>
    b.addEventListener("click", () => openPositionDetail(b.dataset.pos)));
}

// Tema ölçümü bir kez çekilir, sekme her açılışta yeniden istenmez (radar 6 saatte tazelenir).
let TEMA = { veri: null, yukleniyor: false };

/* ===== TEMA MASASI (28 Ağu 2026) — eski "Sektör / tema yoğunlaşması" panelinin yerine.
 *
 * Eski panel yalnız ağırlığı söylüyordu: "%65'in şu temada, riski dağıtmayı düşün."
 * Bu tek başına eylem üretmiyor, çünkü yoğunlaşma ne iyi ne kötü — endeksi yenen bir
 * temada yoğunlaşmak ile geride kalan bir temada yoğunlaşmak aynı şey değil. Panel
 * artık ikinci yarıyı da ölçüyor: temanın evrendeki medyan getirisi ve QQQ farkı.
 *
 * 28 Ağu ölçümü (84 sembol · 6 tema): Finans endeksin +15,0 puan önünde ve orada hiç
 * pozisyon yok; AI · Yarı İletken −8,4 puan geride ve en büyük ağırlık (%37) orada.
 * "Endeksin gerisindeyim" sorusunun cevaplarından biri burada duruyor.
 *
 * NE İDDİA ETMEZ: "önümüzdeki dönemde şu gidecek". 28 Ağu'da bu ÖLÇÜLDÜ
 * (scripts/olcum-tema.mjs · docs/olcumler §19) ve cevap net çıktı: lider tema
 * sonraki ayda tema seçmemeyi +5,6 puan yeniyor GİBİ görünüyor, ama AI · Yarı
 * İletken evrenden çıkarılınca +0,75'e düşüyor — liderliğin %77'si zaten o
 * temadaydı. Ölçülen şey tema momentumu değil, tek bir temanın 17 aylık yükselişi.
 * Üstelik o tema BUGÜN evrenin en zayıfı. Panel bu yüzden sıralar ve susar. */
async function renderSector() {
  const el = $("#sectorBox"); if (!el) return;
  if (!TEMA.veri) {
    if (TEMA.yukleniyor) return;
    TEMA.yukleniyor = true;
    el.innerHTML = `<div class="radar-empty">↻ Tema evreni ölçülüyor…</div>`;
    try { TEMA.veri = await (await fetch("/api/temalar")).json(); }
    catch { TEMA.veri = { ok: false, hata: "ag" }; }
    finally { TEMA.yukleniyor = false; }
  }
  const T = TEMA.veri;
  if (!T?.ok) {
    el.innerHTML = `<div class="radar-empty">${T?.taraniyor
      ? "Radar evreni taranıyor — tema ölçümü tarama bitince gelir."
      : "Tema ölçümü için yeterli mum verisi yok. Radar'ı bir kez açıp bekle."}</div>`;
    return;
  }

  const p1 = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}%${Math.abs(v).toFixed(d)}`);
  const rs = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);

  const h = T.hukum;
  const hukum = h ? `<p class="tm-hukum ${h.ton}">${h.metin}</p>` : "";

  /* Ağırlık şeridi: paranın dağılımı bir bakışta. Renk YOK — dağılım bilgidir,
   * eylem değil; eylem hükümde ve satırdaki RS'te (tasarım kuralı 3). */
  const tutulan = T.satirlar.filter((r) => r.portfoyPct > 0).sort((a, b) => b.portfoyPct - a.portfoyPct);
  const disi = T.disiTema || 0;
  const serit = (tutulan.length || disi) ? `<div class="tm-serit">
    ${tutulan.map((r) => `<i style="width:${r.portfoyPct.toFixed(1)}%" title="${r.title} · %${r.portfoyPct.toFixed(0)}" class="${r.rs3M != null && r.rs3M < 0 ? "zayif" : ""}"></i>`).join("")}
    ${disi ? `<i style="width:${disi.toFixed(1)}%" class="disi" title="Radar evreninde olmayan pozisyonlar · %${disi.toFixed(0)}"></i>` : ""}
  </div>
  <div class="tm-serit-lej">${tutulan.map((r) => `<span><b>${r.title}</b> %${r.portfoyPct.toFixed(0)}</span>`).join("")}
    ${disi ? `<span class="disi"><b>Evren dışı</b> %${disi.toFixed(0)}</span>` : ""}</div>` : "";

  /* Tablo. Sıralama göreli güce göre: en güçlü tema üstte, senin ağırlığın nerede
   * olursa olsun. Ağırlığı olan satır işaretlenir — göz kendi parasını bulsun. */
  const satir = (r) => {
    const seninki = r.portfoyPct > 0;
    const kotuVeAgir = seninki && r.rs3M != null && r.rs3M < 0 && r.portfoyPct >= 25;
    return `<tr class="${seninki ? "tm-seninki" : ""}${kotuVeAgir ? " tm-uyari" : ""}">
      <td class="l tm-ad">
        <b>${r.title}</b>
        <i class="tm-n">${r.n} sembol${r.zayifKanit ? " · zayıf kanıt" : ""}</i>
      </td>
      <td class="tm-med">${p1(r.medyan3M)}</td>
      <td class="tm-rs ${r.rs3M == null ? "" : r.rs3M >= 0 ? "pos" : "neg"}">${rs(r.rs3M)}</td>
      <td class="tm-sen">${seninki ? `<b>%${r.portfoyPct.toFixed(0)}</b>` : `<span class="tm-yok">—</span>`}</td>
      <td class="l tm-lider">${r.lider.map((l) =>
        `<button class="tm-chip${l.owned ? " var" : ""}" data-tsym="${l.sym}" title="${l.ad || l.sym}${l.story ? " — " + l.story : ""}${l.owned ? " · portföyünde var" : ""}">
          ${l.sym}<i class="${l.ret3M >= 0 ? "pos" : "neg"}">${p1(l.ret3M, 0)}</i></button>`).join("")}</td>
    </tr>`;
  };

  const tablo = `<div class="tbl-wrap"><table class="tm-tablo">
    <thead><tr>
      <th class="l">Tema</th>
      <th title="Temadaki sembollerin 3 aylık getirilerinin medyanı">3A medyan</th>
      <th title="Medyan eksi QQQ — temanın endekse göre fazlası, puan">QQQ farkı</th>
      <th title="Hisse pozisyonlarının bu temadaki payı">Ağırlığın</th>
      <th class="l">Temayı taşıyanlar · 3A</th>
    </tr></thead>
    <tbody>${T.satirlar.map(satir).join("")}</tbody></table></div>`;

  const not = `<p class="tm-not">
    ${T.n} sembol · ${T.temaSayisi} tema · QQQ 3 ayda ${p1(T.endeks?.ret3M)} · getiriler mum önbelleğinden (tema ve endeks aynı yöntemle).
    ${disi ? `Portföyünün <b>%${disi.toFixed(0)}</b> kadarı radar evreninde olmayan sembollerde — o kısım bu tabloda ölçülmüyor.` : ""}
    <b>Bu tablo lidere geçmeni söylemez</b> — ölçüldü (28 Ağu): lider tema sonraki ayda tema seçmemeyi
    <b>+5,6 puan</b> yeniyor görünüyor, ama tek bir temayı (AI · Yarı İletken) evrenden çıkarınca
    <b>+0,75'e</b> düşüyor; liderliğin %77'si zaten oradaydı ve o tema bugün evrenin en zayıfı.
    Yani ölçülen şey tema momentumu değil, bir temanın 17 aylık hikâyesiydi.
    <b>Öteki yanlılıklar:</b> evren bugünün listesi (çöküp listeden düşen isimler medyanı iyi gösterir);
    az sembollü temaların medyanı kırılgandır (satırda <i>zayıf kanıt</i> yazar).
  </p>`;

  el.innerHTML = hukum + serit + tablo + not;
  el.querySelectorAll("[data-tsym]").forEach((b) =>
    b.addEventListener("click", () => openChartModal(b.dataset.tsym)));
}


async function renderWeekly() {
  const el = $("#weeklyBox"); if (!el) return;
  el.innerHTML = `<div class="radar-empty">↻ Hesaplanıyor…</div>`;
  let d;
  try { d = await (await fetch("/api/weekly")).json(); } catch { el.innerHTML = `<div class="radar-empty">Veri alınamadı.</div>`; return; }
  if (!d.stocks?.length) { el.innerHTML = `<div class="radar-empty">Haftalık veri için hisse mumları henüz taranmadı. Swing tarayıcıyı bir kez açıp bekle.</div>`; return; }
  const p = d.portfolio;
  const head = p ? `<div class="wk-hero ${cls(p.changeTRY)}">
      <div class="wk-hero-lbl">Bu hafta portföy (${fmtDate(p.fromDate)} → ${fmtDate(p.toDate)})</div>
      <div class="wk-hero-val">${p.changeTRY >= 0 ? "+" : ""}${fmtTRY0(p.changeTRY)} <span class="wk-hero-pct">${p.pct != null ? fmtPct(p.pct) : ""}</span></div>
    </div>` : "";
  const b = d.best, w = d.worst;
  const bw = (b && w) ? `<div class="wk-bw">
      <div>En iyi <b>${b.symbol}</b> <span class="${cls(b.pct)}">${fmtPct(b.pct)}</span></div>
      <div>En kötü <b>${w.symbol}</b> <span class="${cls(w.pct)}">${fmtPct(w.pct)}</span></div>
    </div>` : "";
  const maxAbs = Math.max(1, ...d.stocks.map((s) => Math.abs(s.pct)));
  const rows = d.stocks.map((s) => {
    const w = (Math.abs(s.pct) / maxAbs) * 50; // merkezden ±%50
    const bar = s.pct >= 0
      ? `<span class="wk-bar-pos" style="width:${w}%"></span>`
      : `<span class="wk-bar-neg" style="width:${w}%;margin-left:${50 - w}%"></span>`;
    return `<tr>
      <td class="l sym-link" data-wk="${s.symbol}"><b>${s.symbol}</b></td>
      <td class="wk-bar-cell"><span class="wk-bar-mid"></span>${bar}</td>
      <td class="${cls(s.pct)}">${fmtPct(s.pct)}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `${head}${bw}
    <table class="wk-table"><tbody>${rows}</tbody></table>
    <p class="modal-note">Son 5 işlem günü değişimi · candleCache'ten (ek API maliyeti yok).</p>`;
  el.querySelectorAll("[data-wk]").forEach((b) => b.addEventListener("click", () => openChartModal(b.dataset.wk)));
}

function renderAnalizSummary() {
  const el = $("#analizSummary"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock");
  const totalStock = stocks.reduce((s, h) => s + (h.live?.marketValueTRY || 0), 0);
  // En yoğun tema
  const themeMap = {};
  for (const h of stocks) {
    const k = h.theme?.title || "Diğer";
    themeMap[k] = (themeMap[k] || 0) + (h.live?.marketValueTRY || 0);
  }
  const topTheme = Object.entries(themeMap).sort((a, b) => b[1] - a[1])[0];
  const topPct = topTheme && totalStock ? (topTheme[1] / totalStock) * 100 : 0;
  /* Realize K/Z — TEK KAYNAK: realizedBySym (sunucu).
   * 28 Ağu: bu KPI kendi hesabını yapıyordu — ham trades üzerinden
   * shares×(sellUSD−buyUSD), tarih filtresiz ve swing ayrımsız. Aynı sekmenin
   * altındaki "Realize özeti" paneli realizedBySym okuyordu. İki panel yan yana
   * $77,33 ve $41,57 yazıyordu; farkın $28,27'si portföy kuruluşundan (8 Haz)
   * önceki tek satış, kalanı swing satışlarının çift sayımıydı. CLAUDE.md:
   * "bir sayının iki hesabı varsa biri bozuktur" — hesap tekilleştirildi. */
  const realizedUSD = Object.values(STATE?.realizedBySym || {}).reduce((s, v) => s + (v || 0), 0);
  const realizeSym = Object.values(STATE?.realizedBySym || {}).filter((v) => Math.abs(v) >= 0.005).length;
  // Günlük en iyi/kötü (anlık)
  const withDc = stocks.filter((h) => h.live?.dayChangePct != null);
  withDc.sort((a, b) => b.live.dayChangePct - a.live.dayChangePct);
  const best = withDc[0], worst = withDc[withDc.length - 1];
  const stat = (lbl, val, sub, c = "") => `
    <div class="asum">
      <div class="asum-lbl">${lbl}</div>
      <div class="asum-val ${c}">${val}</div>
      <div class="asum-sub">${sub}</div>
    </div>`;
  el.innerHTML =
    stat("Hisse Değeri", fmtTRY0(totalStock), `${stocks.length} pozisyon`) +
    stat("En Yoğun Tema", topTheme ? `%${topPct.toFixed(0)}` : "—", topTheme ? topTheme[0] : "—", topPct >= 40 ? "neg" : "") +
    stat("Bugün En İyi", best ? best.symbol : "—", best ? fmtPct(best.live.dayChangePct) : "—", best ? cls(best.live.dayChangePct) : "") +
    stat("Bugün En Kötü", worst ? worst.symbol : "—", worst ? fmtPct(worst.live.dayChangePct) : "—", worst ? cls(worst.live.dayChangePct) : "") +
    // fmtUSD0 negatifi "$-240" basar; işaret rakamın önüne gelmeli (CLAUDE.md küçük kurallar)
    stat("Realize K/Z", (realizedUSD < 0 ? "−" : "") + fmtUSD0(Math.abs(realizedUSD)), `${realizeSym} sembol · 8 Haz'dan beri`, cls(realizedUSD));
}

/* ===== Realize Özeti — sembol başına net K/Z (aracı kurum "Yatırım geliri" birebir) ===== */
function renderRealizeSummary() {
  const el = $("#realizeSummary"); if (!el) return;
  const usdtry = STATE?.fx?.usdtry || 0;
  // TEK KAYNAK: realizedBySym (USD) — yalnız portföy kuruluşundan (8 Haz 2026) itibaren işlem geçmişi.
  const calc = STATE?.realizedBySym || {};
  const list = Object.entries(calc)
    .map(([sym, usd]) => ({ sym, usd: +usd, tl: (+usd) * usdtry }))
    .filter((r) => Math.abs(r.usd) >= 0.005)   // sıfır realize'leri gizle
    .sort((a, b) => b.usd - a.usd);
  if (!list.length) { el.innerHTML = `<div class="radar-empty">Portföy kuruluşundan (8 Haz 2026) bu yana realize edilmiş işlem yok.</div>`; return; }
  const pos = list.filter((r) => r.tl >= 0).reduce((s, r) => s + r.tl, 0);
  const neg = list.filter((r) => r.tl < 0).reduce((s, r) => s + r.tl, 0);
  const net = pos + neg;
  const winN = list.filter((r) => r.tl > 0).length;
  const usd = (tl) => (usdtry ? ` <span class="rz-usd">${fmtUSD0(tl / usdtry)}</span>` : "");
  el.innerHTML = `
    <div class="rz-head">
      <div class="rz-h"><span class="rz-h-lbl">NET REALİZE</span><span class="rz-h-val ${cls(net)}">${fmtTRY0(net)}${usd(net)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">Kazanan</span><span class="rz-h-val pos">+${fmtTRY0(pos)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">Kaybeden</span><span class="rz-h-val neg">${fmtTRY0(neg)}</span></div>
      <div class="rz-h"><span class="rz-h-lbl">İsabet</span><span class="rz-h-val">${list.length ? Math.round((winN / list.length) * 100) : 0}% · ${winN}/${list.length}</span></div>
    </div>
    <div class="rz-list">
      ${list.map((r) => `
        <div class="rz-row">
          <span class="rz-sym">${r.sym}</span>
          <span class="rz-amt ${cls(r.tl)}">${r.tl >= 0 ? "+" : ""}${fmtTRY0(r.tl)}${usd(r.tl)}</span>
        </div>`).join("")}
    </div>
    <div class="rz-foot">Portföy kuruluşundan (8 Haz 2026) bu yana · İşlem Geçmişi'ndeki satışlardan hesaplanır.</div>`;
}

/* ===== Profesyonel Risk Masası — korelasyon · VaR · risk katkısı · boyutlama · tahsis · faktör ===== */
let PRORISK = null;
const PRO_TARGETS_KEY = "proAllocTargets";
function proTargets() {
  try { const t = JSON.parse(localStorage.getItem(PRO_TARGETS_KEY)); if (t && typeof t === "object") return t; } catch {}
  return { core: 55, satellite: 20, cash: 20, other: 5 }; // çekirdek hisse / swing / nakit / altın+opsiyon
}
async function renderProRisk() {
  const el = $("#proRiskBox"); if (!el) return;
  if (PRORISK == null) {
    el.innerHTML = `<div class="radar-empty">Risk motoru çalışıyor — getiri serileri hesaplanıyor…</div>`;
    try { PRORISK = await (await fetch("/api/risk")).json(); } catch { PRORISK = { error: true }; }
    korCarpaniYukle(PRORISK);   // aynı yanıt — çarpan için ikinci istek atılmaz
  }
  const R = PRORISK;
  if (!R || R.error) { el.innerHTML = `<div class="radar-empty">Risk verisi alınamadı (mum verisi eksik olabilir).</div>`; return; }
  if (R.empty) { el.innerHTML = `<div class="radar-empty">${R.reason || "Risk için yeterli geçmiş yok"} — birkaç gün veri biriktikçe dolar.</div>`; return; }
  const fx = STATE?.fx?.usdtry || 0;
  const P = R.portfolio, pos = R.positions || [];

  // ---- Panel 1: Risk & Korelasyon ----
  const kpi = (lbl, val, sub, tone = "", tip = "") => `
    <div class="pr-kpi ${tone}">
      <div class="pr-kpi-l">${lbl}${tip ? ` <span class="tip" data-tip="${tip}">?</span>` : ""}</div>
      <div class="pr-kpi-v">${val}</div>
      <div class="pr-kpi-s">${sub}</div>
    </div>`;
  const divTone = P.diversification >= 55 ? "good" : P.diversification >= 35 ? "warn" : "bad";
  const kpis = `<div class="pr-kpis">
    ${kpi("VaR %95 (1 gün)", fx ? fmtTRY0(P.var95USD * fx) : fmtUSD0(P.var95USD), `≈ ${fmtUSD0(P.var95USD)} · portföyün %${P.var95Pct}`, P.var95Pct >= 4 ? "bad" : P.var95Pct >= 2.5 ? "warn" : "good", "Value at Risk: normal koşulda %95 ihtimalle 1 günde bu tutardan FAZLA kaybetmezsin. Tarihsel en kötü %5 gün de hesaba katılır.")}
    ${kpi("Yıllık Volatilite", `%${P.volAnnPct}`, "portföy oynaklığı", P.volAnnPct >= 40 ? "bad" : P.volAnnPct >= 25 ? "warn" : "good", "Portföyün yıllıklandırılmış standart sapması. %25 altı sakin, %40 üstü çok oynak.")}
    ${(() => {
      /* 15 Ağu: beta TEK BAŞINA "piyasadan agresif" diye basılıyordu. Ölçüm (§14)
       * bu portföyde R²'nin 0,13 olduğunu gösterdi — endeks hareketin %13'ünü
       * açıklıyor, yani beta bir tanım değil gürültü. R² düşükken o cümle kurulamaz;
       * alt satır artık R²'yi yazıyor ve düşükse betanın anlamsızlığını söylüyor. */
      if (P.beta == null) return kpi("Beta (SPY)", "—", "—", "", "Piyasaya duyarlılık.");
      const r2 = P.r2;
      const zayif = r2 != null && r2 < 0.3;
      const alt = r2 == null ? "R² bilinmiyor"
        : zayif ? `R² ${r2.toFixed(2)} — endeks açıklamıyor, beta anlamsız`
        : `R² ${r2.toFixed(2)} · ${P.beta > 1.1 ? "piyasadan agresif" : P.beta < 0.9 ? "piyasadan sakin" : "piyasayla uyumlu"}`;
      return kpi("Beta (SPY)", P.beta.toFixed(2), alt, zayif ? "" : (P.beta > 1.3 ? "warn" : ""),
        `${P.betaTuru === "bugünkü ağırlıklar" ? "BUGÜNKÜ ağırlıkların son " + (R.lookback || "N") + " güne uygulanmasıyla hesaplanır — 'bu portföyü o dönem tutsaydım' sorusunun cevabı. Hesabının FİİLEN yaptığı beta bundan farklıdır; onu Temel çizgi panelinde görürsün. " : ""}R² = endeksin portföyü açıklama oranı; düşükse (0.3 altı) risk piyasadan değil hisseye özgüdür ve beta yorumlanamaz.`);
    })()}
    ${kpi("Çeşitlendirme", `%${P.diversification}`, `ort. korelasyon ${P.avgCorr}`, divTone, "Pozisyonlar ne kadar bağımsız hareket ediyor. Düşükse 'çok hisse ama tek bahis' demektir — gerçek çeşitlendirme yok.")}
  </div>`;

  // Korelasyon ısı haritası
  const cc = (v) => v >= 0.7 ? "cc-h" : v >= 0.45 ? "cc-m" : v >= 0.2 ? "cc-l" : v >= -0.2 ? "cc-z" : "cc-n";
  const cm = R.correlation || { syms: [], matrix: [] };
  const corrTable = cm.syms.length >= 2 ? `
    <div class="pr-sub">Korelasyon matrisi <span class="pr-hint">kırmızı = birlikte hareket (çeşitlendirme yok) · yeşil = bağımsız</span></div>
    <div class="pr-corr-wrap"><table class="pr-corr"><thead><tr><th></th>${cm.syms.map((s) => `<th>${s}</th>`).join("")}</tr></thead>
    <tbody>${cm.syms.map((s, i) => `<tr><th>${s}</th>${cm.matrix[i].map((v, j) => `<td class="${i === j ? "cc-self" : cc(v)}" title="${s}↔${cm.syms[j]}: ${v}">${i === j ? "—" : v.toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";

  // Risk katkısı: ağırlığından fazla risk taşıyan pozisyon = gizli risk
  const maxRC = Math.max(1, ...pos.map((p) => Math.abs(p.rcPct)));
  const rcRows = pos.slice(0, 12).map((p) => {
    const over = p.rcPct > p.weightPct + 3;
    return `<div class="pr-rc-row">
      <span class="pr-rc-sym">${p.symbol}</span>
      <div class="pr-rc-bar"><i class="${over ? "over" : ""}" style="width:${Math.max(2, Math.abs(p.rcPct) / maxRC * 100).toFixed(0)}%"></i></div>
      <span class="pr-rc-val ${over ? "neg" : ""}">%${p.rcPct.toFixed(1)}<span class="pr-rc-w"> / ağ. %${p.weightPct}</span></span>
    </div>`;
  }).join("");
  const panel1 = `<div class="pr-block">
    <div class="pr-h2">Risk & Korelasyon</div>
    ${kpis}${corrTable}
    <div class="pr-sub">Risk katkısı <span class="pr-hint">her pozisyonun TOPLAM portföy riskine payı — ağırlığından büyükse (kırmızı) o pozisyon gizli risk taşıyor</span></div>
    <div class="pr-rc">${rcRows}</div>
  </div>`;

  // ---- Panel 2: Tahsis & Rebalancing ----
  const tg = proTargets();
  let coreV = 0, satV = 0, goldV = 0, optV = 0, cashV = 0;
  // 14 Ağu: swing olarak yönetilen bir holding hem coreV'ye hem (defter kaydıyla) satV'ye
  // giriyordu — uydu kovası şişip çekirdek olduğundan büyük görünüyordu. Artık bir pozisyon
  // TEK kovaya düşer: swing işaretliyse (horizon ya da açık defter kaydı) uydu, değilse çekirdek.
  // STATE?. — renderProRisk /api/risk'i BEKLİYOR; ilk açılışta bekleme biterken
  // STATE hâlâ null olabiliyor ve buradaki patlama zincirdeki sonraki tüm
  // render'ları (kıyas, karne, teknikler) sessizce düşürüyordu (16 Ağu).
  const swAcik = STATE?.swingOpen || {};
  const swingYonetiliyor = (h) => h.horizon === "swing" || !!swAcik[String(h.symbol).toUpperCase()];
  for (const h of (STATE?.holdings || [])) {
    const v = h.live?.marketValueTRY || 0;
    if (h.type === "gold") goldV += v;
    else if (h.type === "stock" && swingYonetiliyor(h)) satV += v;
    else coreV += v;
  }
  // Defterdeki ayrı alımlar (Varlıklar'da olmayan kısım) — çift saymadan eklenir
  for (const p of (STATE?.swingPositions || [])) satV += ((p.sayilanValueUSD !== undefined ? p.sayilanValueUSD : p.valueUSD) || 0) * fx;
  const cash = STATE?.cash || {}; cashV = (cash.tl || 0) + (cash.usd || 0) * fx + (cash.eur || 0) * (STATE?.fx?.eurtry || 0);
  for (const o of (STATE?.options || [])) optV += (o.valueTRY || 0) * (o.direction === "short" ? -1 : 1);
  const otherV = goldV + optV;
  const totA = coreV + satV + cashV + otherV;
  const buckets = [
    { key: "core", lbl: "Çekirdek (uzun vade)", val: coreV, tgt: tg.core, color: "var(--green)" },
    { key: "satellite", lbl: "Uydu (swing)", val: satV, tgt: tg.satellite, color: "var(--amber-d, #d98a00)" },
    { key: "cash", lbl: "Nakit (kuru toz)", val: cashV, tgt: tg.cash, color: "#5b8def" },
    { key: "other", lbl: "Altın + Opsiyon", val: otherV, tgt: tg.other, color: "#9b8cff" },
  ];
  const allocRows = buckets.map((b) => {
    const act = totA ? b.val / totA * 100 : 0;
    const drift = act - b.tgt;
    const action = Math.abs(drift) < 4 ? `<span class="pr-ok">dengede</span>` : drift > 0 ? `<span class="pr-warn">%${Math.abs(drift).toFixed(0)} kıs</span>` : `<span class="pr-add">%${Math.abs(drift).toFixed(0)} ekle</span>`;
    return `<div class="pr-alloc-row">
      <span class="pr-alloc-lbl"><i style="background:${b.color}"></i>${b.lbl}</span>
      <div class="pr-alloc-bar"><div class="pr-alloc-fill" style="width:${Math.min(100, act).toFixed(0)}%;background:${b.color}"></div><span class="pr-alloc-tgt" style="left:${Math.min(100, b.tgt)}%" title="hedef %${b.tgt}"></span></div>
      <span class="pr-alloc-pct">%${act.toFixed(0)}<span class="pr-alloc-t"> / %${b.tgt}</span></span>
      <span class="pr-alloc-act">${action}</span>
    </div>`;
  }).join("");
  const panel2 = `<div class="pr-block">
    <div class="pr-h2">Tahsis & Rebalancing <button class="pr-edit-tg" data-pr-edit-targets title="Hedef ağırlıkları düzenle">✎ hedef</button></div>
    <div class="pr-hint">Core-Satellite modeli: çekirdek uzun-vade pozisyonlar + uydu swing'ler + nakit yastığı. Çubuk = gerçek ağırlık, çizgi = hedef. Sapma %4'ü geçince öneri çıkar.</div>
    <div class="pr-alloc">${allocRows}</div>
  </div>`;

  // ---- Panel 3: Pozisyon Boyutlama ----
  const szRows = pos.map((p) => {
    const diff = p.suggestPct != null ? p.weightPct - p.suggestPct : null;
    const flag = diff == null ? "" : diff > 4 ? `<span class="pr-warn">büyük</span>` : diff < -4 ? `<span class="pr-add">yer var</span>` : `<span class="pr-ok">uygun</span>`;
    return `<tr>
      <td class="l"><b>${p.symbol}</b></td>
      <td>%${p.weightPct}</td>
      <td>${p.suggestPct != null ? `%${p.suggestPct}` : "—"}</td>
      <td>${p.adrPct != null ? `%${p.adrPct}` : "—"}</td>
      <td>%${p.volAnnPct ?? "—"}</td>
      <td>${flag}</td>
    </tr>`;
  }).join("");
  const panel3 = `<div class="pr-block">
    <div class="pr-h2">Risk-Bazlı Pozisyon Boyutlama</div>
    <div class="pr-hint">Qullamaggie kuralı tüm portföye: 1×ADR stopta portföyün %1'i risk. "Önerilen" = bu kurala göre ideal ağırlık. Gerçek bundan büyükse pozisyon fazla iri (tek hata canını yakar).</div>
    <div class="tbl-wrap"><table class="pr-size"><thead><tr><th class="l">Sembol</th><th>Gerçek</th><th>Önerilen</th><th>ADR</th><th>Vol</th><th></th></tr></thead><tbody>${szRows}</tbody></table></div>
  </div>`;

  // ---- Panel 4: Faktör & Maruziyet ----
  // Momentum (3a) sıralı
  const momo = pos.filter((p) => p.momo3mPct != null).slice().sort((a, b) => b.momo3mPct - a.momo3mPct);
  const momoRows = momo.map((p) => `<div class="pr-mo-row"><span>${p.symbol}</span><span class="${cls(p.momo3mPct)}">${p.momo3mPct >= 0 ? "+" : ""}%${p.momo3mPct} <small>3a</small></span><span class="${p.momo6mPct != null ? cls(p.momo6mPct) : ""}">${p.momo6mPct != null ? (p.momo6mPct >= 0 ? "+" : "") + "%" + p.momo6mPct + " 6a" : ""}</span></div>`).join("");
  // Sektör/tema konsantrasyonu
  const themeMap = {};
  for (const h of (STATE?.holdings || [])) { if (h.type !== "stock") continue; const k = h.theme?.title || h.theme || "Diğer"; themeMap[k] = (themeMap[k] || 0) + (h.live?.marketValueTRY || 0); }
  const themeTot = Object.values(themeMap).reduce((s, v) => s + v, 0) || 1;
  const themeRows = Object.entries(themeMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => { const pct = v / themeTot * 100; return `<div class="pr-th-row"><span class="pr-th-lbl">${k}</span><div class="pr-th-bar"><i style="width:${pct.toFixed(0)}%;${pct >= 40 ? "background:var(--red)" : ""}"></i></div><span class="pr-th-pct ${pct >= 40 ? "neg" : ""}">%${pct.toFixed(0)}</span></div>`; }).join("");
  // Opsiyon vs Hisse realize (vergi kalemlerinden: label'da Call/Put = opsiyon)
  let optReal = 0, stkReal = 0;
  for (const r of (STATE?.realized2026 || [])) { if (r.pending) continue; /* onay bekleyen hesaba girmez */ const o = /\b(call|put)\b/i.test(r.label || ""); if (o) optReal += Number(r.amountTRY) || 0; else stkReal += Number(r.amountTRY) || 0; }
  const ovsH = `<div class="pr-ovh">
      <div class="pr-ovh-c ${cls(stkReal)}"><div class="pr-ovh-l">Hisse realize</div><div class="pr-ovh-v">${fmtTRY0(stkReal)}</div></div>
      <div class="pr-ovh-c ${cls(optReal)}"><div class="pr-ovh-l">Opsiyon realize</div><div class="pr-ovh-v">${fmtTRY0(optReal)}</div></div>
    </div>${optReal < 0 && stkReal > 0 ? `<div class="pr-flag">Opsiyonlar net zarar, hisseler net kâr. Tezine sadık kal: opsiyon kovalamak yerine hisse tut.</div>` : ""}`;
  const panel4 = `<div class="pr-block">
    <div class="pr-h2">Faktör & Maruziyet</div>
    <div class="pr-fac-grid">
      <div><div class="pr-sub">Momentum (güç sırası)</div><div class="pr-mo">${momoRows || "<div class='pr-hint'>veri yok</div>"}</div></div>
      <div><div class="pr-sub">Tema yoğunlaşması</div><div class="pr-th">${themeRows || "<div class='pr-hint'>veri yok</div>"}</div>
        <div class="pr-sub" style="margin-top:12px">Opsiyon vs Hisse (realize)</div>${ovsH}</div>
    </div>
  </div>`;

  // ---- Panel 5: What-if simülatörü — "şunu yapsam risk nasıl değişir?" ----
  const wiSyms = pos.map((p) => p.symbol);
  const panel5 = `<div class="pr-block">
    <div class="pr-h2">What-if Simülatörü <span class="tip" data-tip="Kademeli satış / ekleme planını uygulamadan ÖNCE portföy riskine etkisini gör. Hesap mevcut risk verisinden (volatilite + korelasyon) yaklaşık türetilir; boşalan para nakit sayılır. Tahmindir, garanti değil.">?</span></div>
    <form class="lab-form" id="wiForm">
      <label class="lab-f"><i>Pozisyon</i><select name="sym">${wiSyms.map((s) => `<option>${s}</option>`).join("")}</select></label>
      <label class="lab-f"><i>Eylem</i><select name="act">
        <option value="sell25">%25 sat</option><option value="sell50">%50 sat</option><option value="sell100">Tamamını sat</option>
        <option value="add">$ ekle (yeni para)</option></select></label>
      <label class="lab-f" id="wiAmtWrap" hidden><i>Tutar $</i><input name="amt" type="number" value="500" min="50" step="50"></label>
      <button type="submit" class="btn primary sm">Hesapla</button>
    </form>
    <div id="wiRes"><div class="pr-hint">Senaryoyu seç, <b>Hesapla</b>'ya bas — VaR · volatilite · beta · yoğunlaşma öncesi/sonrası kıyaslanır.</div></div>
  </div>`;

  el.innerHTML = panel1 + panel2 + panel3 + panel4 + panel5;

  // What-if bağları (innerHTML her render'da tazelenir → burada bağlanır)
  const wiForm = $("#wiForm");
  wiForm?.querySelector('[name="act"]').addEventListener("change", (e) => { $("#wiAmtWrap").hidden = e.target.value !== "add"; });
  wiForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(wiForm);
    $("#wiRes").innerHTML = whatIf(R, String(f.get("sym")), String(f.get("act")), +f.get("amt") || 0);
  });
}

/* What-if matematiği — mevcut /api/risk verisinden YAKLAŞIK yeniden hesap:
 * σ_port = √(Σᵢ Σⱼ wᵢwⱼσᵢσⱼρᵢⱼ); nakit σ=0. Korelasyon matriste yoksa ort. korelasyon kullanılır. */
function whatIf(R, sym, act, amt) {
  const pos = R.positions || [], P = R.portfolio, cm = R.correlation || { syms: [], matrix: [] };
  const me = pos.find((p) => p.symbol === sym);
  if (!me) return `<div class="pr-hint">Pozisyon bulunamadı.</div>`;
  const delta = act === "add" ? Math.max(0, amt) : -me.valueUSD * (act === "sell25" ? 0.25 : act === "sell50" ? 0.5 : 1);
  const rho = (a, b) => {
    if (a === b) return 1;
    const i = cm.syms.indexOf(a), j = cm.syms.indexOf(b);
    return i >= 0 && j >= 0 && cm.matrix[i] ? cm.matrix[i][j] : (P.avgCorr ?? 0.5);
  };
  const calc = (vals) => { // vals: {sym → USD değer}; toplam = yatırılan + nakit (satıştan boşalan)
    const totInv = Object.values(vals).reduce((a, b) => a + b, 0);
    const tot = totInv + Math.max(0, -delta); // satılan kısım nakit olarak portföyde kalır
    let varSum = 0, beta = 0, hhi = 0, topW = 0, topS = "";
    for (const a of Object.keys(vals)) {
      const pa = pos.find((p) => p.symbol === a); const wa = vals[a] / tot;
      const va = (pa.volAnnPct ?? 30) / 100;
      beta += wa * (pa.beta ?? 1);
      const wInv = totInv ? vals[a] / totInv : 0; hhi += wInv * wInv;
      if (wa * 100 > topW) { topW = wa * 100; topS = a; }
      for (const b of Object.keys(vals)) {
        const pb = pos.find((p) => p.symbol === b); const wb = vals[b] / tot;
        varSum += wa * wb * va * ((pb.volAnnPct ?? 30) / 100) * rho(a, b);
      }
    }
    const volAnn = Math.sqrt(Math.max(0, varSum));
    return { volAnnPct: volAnn * 100, var95USD: 1.645 * (volAnn / Math.sqrt(252)) * tot, beta, effN: hhi > 0 ? 1 / hhi : 0, topW, topS, tot };
  };
  const before = {}; for (const p of pos) before[p.symbol] = p.valueUSD;
  const after = { ...before };
  after[sym] = Math.max(0, before[sym] + delta);
  if (after[sym] === 0) delete after[sym];
  const A = calc(before), B = calc(after);
  const row = (l, b, a, fmt, smallGood = true) => {
    const chg = a - b; const good = smallGood ? chg < -0.001 : chg > 0.001;
    const c = Math.abs(chg) < 0.005 ? "" : good ? "win-c" : "loss-c";
    return `<tr><td class="l">${l}</td><td>${fmt(b)}</td><td class="${c}"><b>${fmt(a)}</b></td></tr>`;
  };
  const actTxt = act === "add" ? `${sym}'e $${amt} ekle` : `${sym} pozisyonunun ${act === "sell25" ? "%25'ini" : act === "sell50" ? "%50'sini" : "tamamını"} sat`;
  return `<div class="tbl-wrap lab-tbl"><table>
      <thead><tr><th class="l">Metrik</th><th>Şimdi</th><th>Senaryo sonrası</th></tr></thead>
      <tbody>
        ${row("VaR %95 (1 gün)", A.var95USD, B.var95USD, (v) => fmtUSD0(v))}
        ${row("Yıllık volatilite", A.volAnnPct, B.volAnnPct, (v) => `%${v.toFixed(1)}`)}
        ${row("Beta (SPY)", A.beta, B.beta, (v) => v.toFixed(2))}
        ${row("Etkin pozisyon sayısı", A.effN, B.effN, (v) => v.toFixed(1), false)}
        ${row("En ağır pozisyon", A.topW, B.topW, (v) => `%${v.toFixed(0)}`)}
      </tbody></table></div>
    <div class="bm-note">Senaryo: <b>${actTxt}</b> — en ağır pozisyon senaryo sonrası <b>${B.topS || "—"}</b>. ${act !== "add" ? "Boşalan tutar nakit sayıldı (σ=0)." : "Eklenen tutar yeni para varsayıldı."} Yaklaşık hesaptır; korelasyonlar geçmişten gelir, garanti değildir.</div>`;
}
// Hedef ağırlık düzenleme
$("#proRiskBox")?.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-pr-edit-targets]")) return;
  const t = proTargets();
  const labels = { core: "Çekirdek (uzun vade) %", satellite: "Uydu (swing) %", cash: "Nakit %", other: "Altın+Opsiyon %" };
  const next = { ...t };
  for (const k of ["core", "satellite", "cash", "other"]) {
    const v = await promptDialog({ title: labels[k], message: "Hedef ağırlık (%). Toplam 100 olmalı.", value: String(t[k]), suffix: "%" });
    if (v == null) return; next[k] = v;
  }
  const sum = next.core + next.satellite + next.cash + next.other;
  if (Math.abs(sum - 100) > 0.5) return toast(`Toplam %${sum.toFixed(0)} — 100 olmalı`, "err");
  localStorage.setItem(PRO_TARGETS_KEY, JSON.stringify(next));
  toast("Hedef ağırlıklar güncellendi");
  renderProRisk();
});

/* ===== Risk & Performans Karnesi — günlük net-değer serisinden trader metrikleri ===== */
function renderRisk() {
  const el = $("#riskBox"); if (!el) return;
  const S = STATE;
  const usdtry = S?.fx?.usdtry || 0;
  // Net değer serisi → USD (her snapshot kendi günkü kuruyla çevrilir)
  /* Ölçüm tabanı (16 Ağu): defterin ilk 24 kaydı geriye doldurulmuş — hepsi tek kur,
   * aralarında 30 güne varan boşluk. Seviye olarak anlamlılar (net değer grafiğinde
   * dururlar) ama GÜNLÜK ADIM olarak sahteler; Sharpe, volatilite, maks düşüş, CAGR
   * ve ileri tahmin hepsi günlük adımdan türüyor. Kıyas paneliyle AYNI pencereyi
   * kullanır (server.js · OLCUM_BASLANGIC) — iki panel iki pencere konuşmasın. */
  const tab = S?.meta?.olcumBaslangic || null;
  const series = (S?.history || [])
    .filter((s) => s.total != null && (!tab || String(s.date).slice(0, 10) >= tab))
    .map((s) => ({ date: s.date, v: s.usdtry ? s.total / s.usdtry : (usdtry ? s.total / usdtry : s.total) }))
    .filter((p) => p.v > 0);

  if (series.length < 8) {
    el.innerHTML = `<div class="rk-empty">Risk metrikleri ve ileri tahmin için yeterli geçmiş yok. Her gün otomatik bir net-değer kaydı (snapshot) alınır; ~2 hafta sonra Sharpe, volatilite, düşüş ve tahmin anlamlı olur.
      <div class="rk-empty-bar"><div class="rk-empty-fill" style="width:${Math.min(100, series.length / 14 * 100).toFixed(0)}%"></div></div>
      <b>${series.length}/14 gün</b> birikti.</div>`;
    return;
  }

  /* GETİRİ SERİSİ TEK KAYNAKTAN (16 Ağu). Bu panel getirileri ham net değer
   * değişiminden hesaplıyordu: 29 Haziran'daki 4.900 TL yatırım "kazanç" olarak
   * sayılıyordu (§14d'nin tekrarı) ve Kıyas paneli %−11,0 derken burası %−9,1
   * diyordu. Artık ikisi de kiyas.js'in ürettiği aynı zaman ağırlıklı seriyi
   * kullanıyor — bir sayının iki hesabı varsa biri bozuktur.
   * `series` (dolar seviyeleri) yalnız ileri tahmin grafiğinde kalır: orada
   * gereken şey getiri değil, net değerin kendisi. */
  const KP = KIYAS.veri?.ok ? KIYAS.veri.portfoy : null;
  if (!KP && !KIYAS.yukleniyor) renderKiyas();           // yüklenince kendisi bu paneli tazeler
  const rets = KP?.gunluk?.length ? KP.gunluk : (() => {
    const r = [];
    for (let i = 1; i < series.length; i++) { const x = series[i].v / series[i - 1].v - 1; if (isFinite(x)) r.push(x); }
    return r;
  })();
  const n = rets.length;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
  const sd = Math.sqrt(variance);
  const ANN = Math.sqrt(252);
  const sharpe = KP ? KP.sharpe : (sd > 0 ? (mean / sd) * ANN : null);

  // Toplam getiri + CAGR (gerçek gün sayısına göre)
  const v0 = series[0].v, vN = series[series.length - 1].v;
  const totRet = KP ? KP.getiri : vN / v0 - 1;
  // Pencere de Kıyas'la aynı olsun — aynı sekmede "75 gün" ve "73 gün" okunmasın
  const days = Math.max(1, KIYAS.veri?.ok ? KIYAS.veri.takvimGun
    : (new Date(series[series.length - 1].date) - new Date(series[0].date)) / 86400000);

  // Maksimum düşüş + şu anki düşüş (underwater) — akıştan arındırılmış zincirden
  const ddSeri = KP?.zincir?.length ? KP.zincir : series.map((p) => p.v);
  let peak = -Infinity, maxDD = 0;
  const dd = ddSeri.map((v) => { peak = Math.max(peak, v); const d = v / peak - 1; maxDD = Math.min(maxDD, d); return d; });
  const curDD = dd[dd.length - 1];
  /* Zirve altında geçen süre. Maks düşüş "ne kadar düştün"ü söyler, bu "ne kadar
   * süredir düşüktesin"i — ayrı sorular ve ikincisi hiçbir panelde yoktu. 3 gündür
   * zirvenin altında olmakla 30 gündür olmak aynı şey değildir. */
  let zirveAlti = 0;
  for (let i = dd.length - 1; i >= 0 && dd[i] < -0.001; i--) zirveAlti++;
  let enUzunAlti = 0, _sayac = 0;
  for (const d of dd) { if (d < -0.001) { _sayac++; if (_sayac > enUzunAlti) enUzunAlti = _sayac; } else _sayac = 0; }
  // Zirvenin tarihi: "35 gün" tek başına soyut, "30 Haziran'dan beri" bir olayı işaret eder
  const ddTarih = KIYAS.veri?.ok ? KIYAS.veri.tarihler : series.map((p) => p.date);
  const zirveGun = (zirveAlti && ddTarih?.length === dd.length) ? ddTarih[dd.length - 1 - zirveAlti] : null;
  const trGun = (g) => { try { return new Date(g).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }); } catch { return null; } };


  // Konsantrasyon (holdings piyasa değerinden)
  const mvs = (S?.holdings || [])
    .filter((h) => h.type === "stock" && h.live?.marketValueUSD != null)
    .map((h) => ({ sym: String(h.symbol).toUpperCase(), mv: h.live.marketValueUSD }));
  const totMV = mvs.reduce((a, b) => a + b.mv, 0);
  let hhi = null, effN = null, topW = null, topSym = null;
  if (totMV > 0 && mvs.length) {
    hhi = mvs.reduce((a, b) => a + (b.mv / totMV) ** 2, 0);
    effN = 1 / hhi;
    const top = mvs.slice().sort((a, b) => b.mv - a.mv)[0];
    topW = (top.mv / totMV) * 100; topSym = top.sym;
  }

  // biçim yardımcıları
  const pf = (frac, d = 1) => (frac == null || !isFinite(frac) ? "—" : `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(d)}%`);
  const pp = (frac, d = 0) => (frac == null || !isFinite(frac) ? "—" : `${(frac * 100).toFixed(d)}%`);
  const rat = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));

  const hero = (lbl, val, sub, c = "", tip = "") =>
    `<div class="rk-card"><div class="rk-card-lbl">${lbl}${tip ? tipIcon(tip) : ""}</div><div class="rk-card-val ${c}">${val}</div><div class="rk-card-sub">${sub}</div></div>`;

  // ===== İleriye dönük tahmin (geometrik Brownian — geçmiş getiri eğilimi + oynaklık) =====
  const muLog = mean - variance / 2;            // günlük log-sürüklenme
  const HZ = 126;                               // ~6 ay iş günü
  const z25 = 0.674;                            // %25–75 bandı için z-skoru
  const proj = [];
  for (let t = 1; t <= HZ; t++) {
    const drift = muLog * t, vol = sd * Math.sqrt(t);
    proj.push({ t, med: vN * Math.exp(drift), lo: vN * Math.exp(drift - z25 * vol), hi: vN * Math.exp(drift + z25 * vol) });
  }
  const pEnd = proj[proj.length - 1];           // 6 ay sonu medyan/alt/üst
  const p3 = proj[Math.min(proj.length - 1, 62)]; // ~3 ay (63 iş günü)
  const MILES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
  const milestone = MILES.find((m) => m > vN) || Math.ceil(vN / 1e6 + 1) * 1e6;
  const Lm = Math.log(milestone / vN);          // hedefe log-mesafe
  // analitik varış (iş günü): muLog·t ± z·sd·√t = Lm  →  x=√t için ikinci derece denklem
  const etaT = (sign) => { if (muLog <= 0) return null; const b = sign * z25 * sd; const x = (-b + Math.sqrt(b * b + 4 * muLog * Lm)) / (2 * muLog); return x > 0 ? x * x : null; };
  const bdMon = (bd) => (bd == null ? null : bd / 21);   // iş günü → ay
  const etaFmt = (mon) => (mon == null ? "belirsiz" : mon < 1.2 ? `~${Math.max(1, Math.round(mon * 4.3))} hafta` : mon <= 18 ? `~${Math.round(mon)} ay` : `~${(mon / 12).toFixed(1)} yıl`);
  const etaMed = etaT(0), etaFast = etaT(1), etaSlow = etaT(-1);
  const fcText = muLog > 0
    ? `Mevcut tempoda <b>${fmtUSD0(milestone)}</b> eşiği medyan <b>${etaFmt(bdMon(etaMed))}</b> uzakta — iyimser ${etaFmt(bdMon(etaFast))}, temkinli ${etaFmt(bdMon(etaSlow))}. <b>3 ay</b> sonra medyan ≈ <b>${fmtUSD0(p3.med)}</b>, <b>6 ay</b> ≈ <b>${fmtUSD0(pEnd.med)}</b> (olası ${fmtUSD0(pEnd.lo)}–${fmtUSD0(pEnd.hi)}).`
    : `Son ${series.length} günün eğilimi yatay/negatif — bu tempoda <b>${fmtUSD0(milestone)}</b> eşiği için anlamlı varış süresi yok. 3 ay olası ${fmtUSD0(p3.lo)}–${fmtUSD0(p3.hi)}, 6 ay <b>${fmtUSD0(pEnd.lo)}–${fmtUSD0(pEnd.hi)}</b>. Eğilim pozitife dönünce netleşir.`;

  // ===== Getiri kaynak dökümü: kilitli realize + açık kâğıt kâr + opsiyon (Kaan: "48% nereden?") =====
  const realizedTot = Object.values(REALIZED_USD || {}).reduce((a, b) => a + (b || 0), 0);
  const unrealTot = (S?.holdings || []).filter((h) => h.type === "stock").reduce((a, h) => {
    const px = h.live?.priceUSD, q = h.quantity, c = h.costUSD;
    return (px != null && q != null && c != null) ? a + (px - c) * q : a;
  }, 0);
  const optTot = (S?.options || []).reduce((a, o) => a + (Number(o.plUSD) || 0), 0);
  const srcTot = realizedTot + unrealTot + optTot;
  const srcAbs = Math.max(Math.abs(realizedTot), Math.abs(unrealTot), Math.abs(optTot), 1);
  const srcRow = (lbl, val, note2) => `<div class="rk-src-row">
    <span class="rk-src-l">${lbl}<i>${note2}</i></span>
    <span class="rk-src-track"><span class="rk-src-bar ${val >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(val) / srcAbs * 100).toFixed(0)}%"></span></span>
    <span class="rk-src-v ${cls(val)}">${val >= 0 ? "+" : ""}${fmtUSD0(val)}</span></div>`;
  const srcBlock = `<div class="rk-src">
    <div class="rk-src-head"><b>Getiri nereden geliyor?</b> <span class="rk-src-tot ${cls(srcTot)}">toplam kâr ${srcTot >= 0 ? "+" : ""}${fmtUSD0(srcTot)}</span></div>
    ${srcRow("Kilitli realize", realizedTot, "satılan · cebe girdi, kaybedilemez")}
    ${srcRow("Açık kâğıt kâr", unrealTot, "hâlâ piyasada · riskli")}
    ${optTot !== 0 ? srcRow("Opsiyon", optTot, "açık opsiyon K/Z") : ""}
    <div class="rk-src-note">Kilitli kısım büyükse tezin işliyor — kârı cebe koyup ana parayı büyütüyorsun. Kâğıt kâr geri verilebilir; kademeli realize ile kilitle (Kural 1).</div>
  </div>`;

  // ===== Sağlık skoru (Sharpe + düşüş + çeşitlendirme → tek okunur değer) =====
  let hs = 50;
  if (sharpe != null) hs += Math.max(-26, Math.min(26, sharpe * 13));
  hs += Math.max(-26, maxDD * 100 * 0.9);
  if (effN != null) hs += Math.max(-14, Math.min(10, (effN - 2) * 6));
  hs = Math.round(Math.max(3, Math.min(99, hs)));
  const hLbl = hs >= 75 ? "güçlü" : hs >= 55 ? "sağlıklı" : hs >= 40 ? "dikkat" : "kırılgan";
  const hCls = hs >= 75 ? "pos" : hs >= 55 ? "" : hs >= 40 ? "warn" : "neg";

  /* 16 Ağu: bu not eskiden Sharpe ve maks düşüşü tekrar okuyordu — ikisi de artık
   * Kıyas karnesinde, endeksin yanında. Not yalnız BU panelin söylediği şeyi söyler:
   * skor neyden kırıldı ve yoğunlaşma seni sallar mı (Kural 1). */
  const kirilan = [];
  if (sharpe != null && sharpe < 1) kirilan.push("riske göre getiri zayıf");
  if (maxDD < -0.2) kirilan.push(`düşüş derin (${pp(maxDD)})`);
  if (effN != null && effN < 2.5) kirilan.push("yoğunlaşma yüksek");
  const note = `Sağlık skoru <b class="${hCls}">${hs}/100</b> (${hLbl})` +
    (kirilan.length ? ` — skoru kıran: <b>${kirilan.join("</b>, <b>")}</b>. ` : ` — üç bileşende de sorun yok. `) +
    (effN != null ? `Gerçekte <b>${effN.toFixed(1)}</b> pozisyona dağılmışsın${topSym ? ` (en ağır <b>${topSym}</b> %${topW.toFixed(0)})` : ""}${effN < 2.5 || (topW && topW > 40) ? ` — tek hisse seni sallayabilir (Kural 1).` : "."}` : "") +
    (curDD < -0.005 ? ` Şu an zirveden <b class="neg">${pp(curDD)}</b> aşağıdasın.` : " Şu an zirveye yakınsın.");

  // ===== Birleşik grafik: geçmiş net değer + tahmin medyanı + %25–75 bandı + eşik =====
  const W = 720, HC = 250, pad = { l: 6, r: 70, t: 16, b: 24 };
  const base = series.length - 1;
  const spanX = base + HZ;
  const xAt = (i) => pad.l + (i / spanX) * (W - pad.l - pad.r);
  const pastMax = Math.max(...series.map((p) => p.v)), pastMin = Math.min(...series.map((p) => p.v));
  const hiEnd = pEnd.hi, loEnd = pEnd.lo;
  const yMax = Math.max(pastMax, hiEnd) * 1.06;
  const yMin = Math.max(0, Math.min(pastMin, loEnd) * 0.96);
  const showMile = milestone <= yMax;   // eşik ancak görüş alanındaysa çizilir
  const yAt = (v) => pad.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (HC - pad.t - pad.b);
  const pastPts = series.map((p, i) => [xAt(i), yAt(p.v)]);
  const pastD = smoothPath(pastPts);
  const areaD = `${pastD} L ${xAt(base).toFixed(1)} ${yAt(yMin).toFixed(1)} L ${xAt(0).toFixed(1)} ${yAt(yMin).toFixed(1)} Z`;
  const medD = smoothPath([[xAt(base), yAt(vN)], ...proj.map((p) => [xAt(base + p.t), yAt(p.med)])]);
  const hiPts = proj.map((p) => [xAt(base + p.t), yAt(p.hi)]);
  const loPts = proj.map((p) => [xAt(base + p.t), yAt(p.lo)]);
  const bandPts = [[xAt(base), yAt(vN)], ...hiPts, ...loPts.reverse()].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const yMile = yAt(milestone), xToday = xAt(base);
  const chartSvg = `<svg class="rk-fc-svg" viewBox="0 0 ${W} ${HC}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${bandPts}" fill="var(--green-soft)" opacity=".8"/>
    <path d="${areaD}" fill="var(--up-soft)"/>
    ${showMile ? `<line x1="${pad.l}" y1="${yMile.toFixed(1)}" x2="${(W - pad.r).toFixed(1)}" y2="${yMile.toFixed(1)}" stroke="var(--ink2)" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>` : ""}
    <line x1="${xToday.toFixed(1)}" y1="${pad.t}" x2="${xToday.toFixed(1)}" y2="${(HC - pad.b).toFixed(1)}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    <path d="${pastD}" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${medD}" fill="none" stroke="var(--green-d)" stroke-width="1.8" stroke-dasharray="5 4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;

  el.innerHTML = `
    <div class="rk-top">
      <div class="rk-health">
        <div class="rk-health-score ${hCls}">${hs}<span>/100</span></div>
        <div class="rk-health-lbl">Portföy sağlığı · <b class="${hCls}">${hLbl}</b></div>
        <div class="rk-hbar"><span class="rk-hmark" style="left:${hs}%"></span></div>
        <div class="rk-health-sub">Sharpe ${rat(sharpe)} · maks. düşüş ${pp(maxDD)} · ${effN != null ? effN.toFixed(1) + " etkin pozisyon" : "—"}</div>
      </div>
      <div class="rk-heads">
        ${hero("Şu Anki Düşüş", curDD < -0.005 ? `<span class="neg">${pp(curDD)}</span>` : "zirvede",
          curDD < -0.005 ? `en derin noktası ${pp(maxDD)}` : "yeni zirvedesin", "",
          "Zirveden BUGÜN ne kadar aşağıdasın. Maksimum düşüş geçmişi anlatır, bu şu anki durumu — pozisyon kararı bunun üstünden verilir.")}
        ${hero("Zirve Altında", zirveAlti ? `${zirveAlti} gün` : "0 gün",
          !zirveAlti ? "bugün yeni zirve"
            : zirveGun ? `son zirve ${trGun(zirveGun)}`
            : `bu pencerede en uzunu ${enUzunAlti} gün`, "",
          "Kaç kayıttır yeni zirve görmedin. 3 gündür zirvenin altında olmakla 30 gündür olmak aynı şey değil — ikincisi tezin çalışmadığının işareti olabilir.")}
        ${hero("Çeşitlendirme", effN != null ? effN.toFixed(1) : "—", topSym ? `en ağır ${topSym} %${topW.toFixed(0)}` : "etkin pozisyon", effN != null && effN < 2.5 ? "neg" : "", "Kaç bağımsız pozisyona dağılmışsın (1/HHI). Düşükse tek hisse seni sallar — Kural 1.")}
      </div>
    </div>

    ${srcBlock}

    <div class="rk-fc">
      <div class="rk-fc-head"><b>Net değer · 6 ay ileri tahmin</b><span class="rk-fc-cap">geçmiş eğilim + oynaklıktan türetildi</span></div>
      <div class="rk-fc-chart">
        ${chartSvg}
        ${showMile ? `<span class="rk-fc-mile" style="top:${(yMile / HC * 100).toFixed(1)}%">${fmtUSD0(milestone)}</span>` : ""}
        <span class="rk-fc-today" style="left:${(xToday / W * 100).toFixed(1)}%">bugün</span>
      </div>
      <div class="rk-legend">
        <span><i class="lg-line"></i> geçmiş</span>
        <span><i class="lg-dash"></i> tahmin (medyan)</span>
        <span><i class="lg-band"></i> %25–75 olası aralık</span>
        ${showMile ? `<span><i class="lg-mile"></i> ${fmtUSD0(milestone)} eşiği</span>` : ""}
      </div>
      <div class="rk-fc-eta">${fcText}</div>
    </div>

    <div class="rk-note">${note}
      <span class="rk-disc">Tahmin geçmiş volatiliteden türetilen bir <b>olasılık aralığıdır</b>, garanti değil.</span></div>
    <div class="rk-cross">Getiri · Sharpe · volatilite · en kötü gün · pozitif gün → <b>Kıyas</b> panelinde,
      endeksin aynı sayılarıyla yan yana. Tek başına okunan bir Sharpe iyi mi kötü mü söylemez.</div>`;
}

/* ===== KIYAS — "piyasayı yendin mi?" ======================================
 * 16 Ağu. Bu soruya iki panel ayrı ayrı cevap veriyordu ve iki farklı sayı
 * söylüyorlardı: Risk karnesinin altındaki "Benchmark" bloğu %66,7, altındaki
 * "Temel çizgi" paneli TWR ile daha düşük. Benchmark bloğunun alt notunda
 * "TWR — para giriş/çıkışı bozmaz" yazıyordu ama serisi akıştan hiç
 * arındırılmamıştı; PR #51'de temel çizgide düzeltilen hata orada duruyordu.
 * Not, ölçümü değil ölçümün olmasını istediğimiz hâlini anlatıyordu.
 *
 * İki panel bire indi ve sekmenin BAŞINA alındı: CLAUDE.md'nin dört ölçüm
 * tuzağından biri temel çizgi yokluğu — "%44 getirdim" cümlesi tek başına iyi
 * mi kötü mü söylemiyor. Sayfanın ilk söylediği şey artık bu.
 *
 * Hesap burada değil: kiyas.js (saf + 25 test) → /api/kiyas. Burası yalnız çizer.
 */
let KIYAS = { veri: null, yukleniyor: false };
async function renderKiyas() {
  const el = $("#kiyasBox"); if (!el) return;
  if (!KIYAS.veri) {
    if (!KIYAS.yukleniyor) {
      KIYAS.yukleniyor = true;
      el.innerHTML = `<div class="radar-empty">Endeks verisi alınıyor…</div>`;
      try { KIYAS.veri = await (await fetch("/api/kiyas")).json(); }
      catch { KIYAS.veri = { ok: false, neden: "ag" }; }
      finally { KIYAS.yukleniyor = false; }
      // Risk karnesi de bu seriyi kullanıyor — geldiğinde onu da tazele
      if ($("#riskBox")) renderRisk();
    } else return;
  }
  const K = KIYAS.veri;
  const ray = $("#analizSecKiyas");
  if (!K?.ok) {
    const mesaj = K?.neden === "kayit" ? `Kıyas için en az ${K.minGun} günlük net değer kaydı gerek — şu an ${K.n}.`
      : K?.neden === "ortak" ? `Portföy kayıtlarıyla endeks barları yalnız ${K.n} günde örtüşüyor — sağlıklı kıyas için az.`
      : K?.neden === "endeks" ? "Endeks verisi alınamadı — kaynak meşgul olabilir, birkaç dakika sonra tazele."
      : "Kıyas hesaplanamadı.";
    if (ray) ray.textContent = "ölçülmedi — yeterli ortak gün yok";
    el.innerHTML = `<div class="radar-empty">${mesaj}</div>`;
    return;
  }

  const ana = K.ana || "QQQ";
  const adlar = Object.keys(K.endeks);
  // Bölüm rayı kendi kanıt miktarını yazar (CLAUDE.md tasarım kuralı 1)
  if (ray) ray.textContent = `${K.n} ortak gün · ${K.takvimGun} takvim günü · zaman ağırlıklı`;

  // ---- biçimleyiciler. fmtUSD0/fmtPct değil: burada her şey fraksiyon ve
  //      işaret rakamın ÖNÜNE gelmeli (CLAUDE.md küçük kurallar).
  const s2 = (f, d = 1) => (f == null || !isFinite(f) ? "—" : `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(d)}%`);
  const y0 = (f, d = 0) => (f == null || !isFinite(f) ? "—" : `${(f * 100).toFixed(d)}%`);
  const n2 = (x, d = 2) => (x == null || !isFinite(x) ? "—" : x.toFixed(d));
  const yp = (f, d = 0) => (f == null || !isFinite(f) ? "—" : `%${(f * 100).toFixed(d)}`);  // düz metin içinde Türkçe sıra
  const tar = (g) => { try { return new Date(g).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }); } catch { return g; } };
  const AD = { QQQ: "Nasdaq-100 · QQQ", SPY: "S&P 500 · SPY" };

  /* ---- 1. HÜKÜM. Renk yalnız eylem gerektiren yerde (tasarım kuralı 3) ve
   *      zafer rengi hak edilmeden verilmez: alfa pozitif olsa da düşüş bedeli
   *      ağırsa sayı yeşil basılmaz — kart kendi cümlesinin tersini okutmasın. */
  const h = K.hukum;
  const alfaTon = !h ? "" : h.ton === "ok" ? "pos" : h.ton === "bad" ? "neg" : "";
  const hero = `<div class="ky-hero">
    <div class="ky-hero-n">
      <span class="ky-hero-lbl">${ana} karşısında</span>
      <b class="ky-hero-v ${alfaTon}">${s2(K.endeks[ana]?.alfa)}</b>
      <span class="ky-hero-sub">${K.n} ortak günde · zaman ağırlıklı getiri farkı</span>
    </div>
    <p class="ky-hukum ${h?.ton || ""}">${h?.metin || "Hüküm için yeterli veri yok."}</p>
  </div>`;

  /* ---- 1b. GİRDİ DENETİMİ (28 Ağu). Hükmün hemen altında durur, çünkü hükmü
   *      nitelendiriyor: hesap doğru olsa da girdi mutabık değilse sayı yanlıştır.
   *      Ölçülen bir günde portföy sert düştü; o gün hisseler yükselmişti ve
   *      piyasa tarafı günün tek alımını doğru yansıtmıştı — nakitten fazladan
   *      para çıkmıştı, ne satış ne akış olarak. O tek gün alfanın büyük bir
   *      bölümünü üretiyordu. Bunu yazmayan panel okuyucuya olduğundan emin bir
   *      sayı verir (CLAUDE.md · kanıtı olmayan bölüm var gibi davranmaz). */
  const mn = K.mutabakatNotu;
  const mk = K.mutabakat?.karne;
  const mutSatir = !mn || mn.ton === "ok" ? "" : `<div class="ky-mutabakat ${mn.ton}">
    <div class="ky-mut-h">${mn.ton === "bad" ? "Bu sayıya tam güvenme — girdi mutabık değil" : "Girdide kayıt uyuşmazlığı var"}</div>
    <p>${mn.metin.replace(/\d{4}-\d{2}-\d{2}/g, (g) => tar(g))}</p>
    ${(K.mutabakat?.gunler || []).filter((g) => g.ariza === "deger-acigi").slice(0, 4).map((g) =>
      `<div class="ky-mut-g"><span>${tar(g.d)}</span><b class="${g.cashAcik < 0 ? "neg" : "pos"}">${g.cashAcik < 0 ? "−" : "+"}$${Math.abs(g.cashAcik).toFixed(0)}</b>
        <i>net değere ${s2(g.sahteGetiri, 1)} · ${g.semboller.length ? g.semboller.join(", ") : "o gün kayıtlı işlem yok"}</i></div>`).join("")}
    <p class="ky-mut-n">Düzeltmek için: o günün gerçek para hareketini <b>Pano → Para giriş/çıkış</b>'a kaydet ya da eksik işlemi ekle. Kayıt girildiği anda bu panel yeniden hesaplar${mk?.acikGun ? ` — düzelme ${Math.abs(mk.bilesikEtkiPuan).toFixed(1)} puana kadar olabilir` : ""}.</p>
  </div>`;

  /* ---- 2. YARIŞ. Üç seri 100'e normalize; portföy dolu, endeksler ince.
   *      Aynı sayıyı tablo da yazıyor — grafik SIRALAMAYI ve yolu gösterir,
   *      okuma değerini değil. */
  const W = 720, HG = 170, pd = { l: 4, r: 52, t: 12, b: 16 };
  const seriler = [
    { ad: "Portföyün", z: K.portfoy.zincir, sinif: "ky-p", kalin: 2.4 },
    ...adlar.map((a) => ({ ad: a, z: K.endeks[a].zincir, sinif: a === ana ? "ky-x1" : "ky-x2", kalin: 1.5 })),
  ];
  const hepsi = seriler.flatMap((s) => s.z);
  const yHi = Math.max(...hepsi) * 1.03, yLo = Math.min(...hepsi) * 0.98;
  const xAt = (i, n) => pd.l + (n > 1 ? i / (n - 1) : 0) * (W - pd.l - pd.r);
  const yAt = (v) => pd.t + (1 - (v - yLo) / (yHi - yLo || 1)) * (HG - pd.t - pd.b);
  const yol = (z) => z.map((v, i) => `${i ? "L" : "M"} ${xAt(i, z.length).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");
  const uc = (s) => ({ y: yAt(s.z[s.z.length - 1]), v: s.z[s.z.length - 1] - 1 });
  const grafik = `<div class="ky-grafik">
    <svg viewBox="0 0 ${W} ${HG}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${pd.l}" y1="${yAt(1).toFixed(1)}" x2="${(W - pd.r).toFixed(1)}" y2="${yAt(1).toFixed(1)}"
            stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
      ${seriler.map((s) => `<path d="${yol(s.z)}" fill="none" class="${s.sinif}" stroke-width="${s.kalin}"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join("")}
    </svg>
    ${seriler.map((s) => { const u = uc(s); return `<span class="ky-uc ${s.sinif}" style="top:${(u.y / HG * 100).toFixed(1)}%">${s2(u.v, 0)}</span>`; }).join("")}
    <div class="ky-lejant">${seriler.map((s) => `<span class="${s.sinif}"><i></i>${s.ad}</span>`).join("")}
      <span class="ky-lejant-not">başlangıç = 100</span></div>
  </div>`;

  /* ---- 3. TABLO. Getiri tek başına yanıltır; aynı satırda riskiyle okunur.
   *      "iyi" sütunu değil "sen vs endeks" — kazandığın hücre vurgulanır. */
  const satirlar = [
    ["Getiri", (m) => m.getiri, s2, true, "Pencere başından bugüne, dolar bazında, zaman ağırlıklı"],
    ["Yıllık volatilite", (m) => m.yillikVol, (v) => y0(v), false, "Günlük getirilerin √252 ile yıllıklanmış oynaklığı — düşük olan iyi"],
    ["Sharpe", (m) => m.sharpe, (v) => n2(v), true, "Getiri ÷ oynaklık. Aynı getiriyi daha az sarsıntıyla alan kazanır"],
    ["Maks düşüş", (m) => m.maxDD, s2, true, "Zirveden dibe en kötü kayıp — katlandığın sarsıntı"],
    ["En kötü gün", (m) => m.enKotuGun, s2, true, "Tek günde gördüğün en sert düşüş"],
    ["Pozitif gün", (m) => m.pozitifOran, (v) => y0(v), true, "Kaç günün artıda kapandığı"],
  ];
  const tblSatir = ([ad, al, bic, buyukIyi, ipucu]) => {
    const sen = al(K.portfoy);
    const huc = adlar.map((a) => {
      const v = al(K.endeks[a]);
      return `<td class="ky-t-x">${bic(v)}</td>`;
    }).join("");
    const enIyiEndeks = adlar.map((a) => al(K.endeks[a])).filter((v) => v != null);
    const kiyasDeger = enIyiEndeks.length ? (buyukIyi ? Math.max(...enIyiEndeks) : Math.min(...enIyiEndeks)) : null;
    const kazandi = sen != null && kiyasDeger != null && (buyukIyi ? sen > kiyasDeger : sen < kiyasDeger);
    return `<tr title="${ipucu}">
      <td class="l ky-t-k">${ad}</td>
      <td class="ky-t-sen ${kazandi ? "kazandi" : ""}">${bic(sen)}</td>
      ${huc}</tr>`;
  };
  const tablo = `<div class="tbl-wrap"><table class="ky-tablo">
    <thead><tr><th class="l"></th><th>Sen</th>${adlar.map((a) => `<th>${a}</th>`).join("")}</tr></thead>
    <tbody>${satirlar.map(tblSatir).join("")}</tbody></table></div>`;

  /* ---- 4. KARAKTER. Beta R² OLMADAN YORUMLANMAZ (docs/olcumler §14): R² düşükse
   *      endeks portföyü açıklamıyordur ve beta gürültünün eğimidir. Yakalama
   *      oranları asimetriyi gösterir — getiri tek başına söylemediği şeyi. */
  const kart = (a) => {
    const e = K.endeks[a], yk = e.yakalama || {};
    const dusukR2 = e.r2 != null && e.r2 < 0.30;
    return `<div class="ky-kart">
      <div class="ky-kart-h">${AD[a] || a}</div>
      <div class="ky-kart-g">
        <div><span>Beta</span><b>${n2(e.beta)}</b></div>
        <div><span>R²</span><b class="${dusukR2 ? "ky-zayif" : ""}">${n2(e.r2)}</b></div>
        <div><span>Yukarı yakalama</span><b>${e.yakalama?.yukari != null ? y0(e.yakalama.yukari) : "—"}</b></div>
        <div><span>Aşağı yakalama</span><b>${e.yakalama?.asagi != null ? y0(e.yakalama.asagi) : "—"}</b></div>
      </div>
      <p class="ky-kart-y">${e.r2 == null
        ? "Beta için yeterli ortak gün yok."
        : dusukR2
          ? `Endeksin açıklama gücü <b>${yp(e.r2)}</b> — portföyünün hareketi büyük ölçüde <b>hisseye özgü</b>. Bu durumda beta yorumlanamaz; alfa da piyasa becerisi değil, tek tek hisse seçimidir.`
          : `Endeksin açıklama gücü <b>${yp(e.r2)}</b> — beta ${n2(e.beta)} anlamlı okunabilir.`}
        ${yk.yukari != null && yk.asagi != null ? `<i>Endeksin yükseldiği günlerde onun <b>${n2(yk.yukari)} katı</b> kazanıyor, düştüğü günlerde <b>${n2(yk.asagi)} katı</b> kaybediyorsun (${yk.yukariN}↑ / ${yk.asagiN}↓ gün) — ${
          yk.yukari > 1.2 && yk.asagi > 1.2
            ? `iki yönde de endeksi büyütüyorsun, <b>kaldıraç gibi davranıyor</b>${yk.yukari > yk.asagi ? "; yine de yukarı payın aşağı payından büyük" : ". Üstelik aşağı payın yukarı payından büyük: asimetri aleyhine"}`
            : yk.yukari > yk.asagi ? "asimetri lehine" : "asimetri aleyhine: düşüşü yükselişten çok alıyorsun"}.</i>` : ""}
        ${a === "SPY" ? `<i>Risk Masası'ndaki beta bundan farklıdır — o <b>bugünkü ağırlıkları</b> geçmişe uygular, buradaki ise hesabın fiilen yaptığıdır (docs/olcumler.md §14).</i>` : ""}
      </p>
    </div>`;
  };

  /* ---- 5. SON DÖNEM. Tüm pencerenin alfası geçmişi anlatır; edge HÂLÂ var mı
   *      sorusunu ayrı sormak gerek. Kısa pencere → hüküm vermez, işaret eder. */
  const sonlar = adlar.filter((a) => K.endeks[a].sonAlfa != null);
  const sonBlok = sonlar.length ? `<div class="ky-son">
    <div class="ky-son-h">Son ${K.endeks[sonlar[0]].sonGun} günde alfa</div>
    ${sonlar.map((a) => `<div class="ky-son-r"><span>${a}</span><b class="${K.endeks[a].sonAlfa >= 0 ? "pos" : "neg"}">${s2(K.endeks[a].sonAlfa)}</b></div>`).join("")}
    <p class="ky-son-n">${(() => {
      const sonNeg = sonlar.every((a) => K.endeks[a].sonAlfa < 0);
      const sonPoz = sonlar.every((a) => K.endeks[a].sonAlfa > 0);
      const tumNeg = adlar.every((a) => (K.endeks[a].alfa ?? 0) < 0);
      const tumPoz = adlar.every((a) => (K.endeks[a].alfa ?? 0) > 0);
      if (tumPoz && sonNeg) return "Tüm pencerede öndesin ama <b>son dönemde değilsin</b> — üstünlük geçmişten geliyor. Bu kadar kısa pencere hüküm vermez, izlemeye alır.";
      if (tumNeg && sonNeg) return "Hem tüm pencerede hem son dönemde gerisin — <b>tutarlı geri kalış</b>, geçici bir sapma değil. Kısa pencere yine de tek başına kanıt değil.";
      if (tumNeg && sonPoz) return "Pencerenin tamamında gerisin ama <b>son dönemde öndesin</b> — toparlanma işareti olabilir; 30 gün bunu doğrulamaya yetmez.";
      return "Son dönem tüm pencereyle aynı yönde. Kısa pencere, tek başına kanıt değil.";
    })()}</p>
  </div>` : "";

  const not = `<p class="ky-not">
    ${K.n} ortak gün · ${tar(K.d0)} → ${tar(K.d1)} · kurdan arındırılmış (TL anlık görüntü ÷ USDTRY).
    Getiri <b>zaman ağırlıklı</b>${K.akisN ? ` · ${K.akisN} para hareketi arındırıldı` : ""};
    yatırdığın para kazanç sayılmaz.
    ${K.atlanan ? `Günlük istatistik (volatilite, Sharpe, beta, en kötü gün) ${K.gunlukN} gerçek günden — defterdeki ${K.atlanan} seyrek sıçrama dışarıda, birikimli getiri onları içerir.` : ""}
    <b>Yanlılık:</b> pencere kısa ve tek rejim; bu panel "bu dönemde ne oldu"yu söyler, "strateji iyi mi"yi değil.
  </p>`;

  el.innerHTML = hero + mutSatir + grafik + tablo +
    `<div class="ky-alt">${adlar.map(kart).join("")}${sonBlok}</div>` + not;
}

/* ===== Pozisyon Teknikleri — her holding'in trader metrikleri (h.sig'ten) ===== */
function renderPosTech() {
  const el = $("#posTechBox"); if (!el) return;
  const stocks = (STATE?.holdings || []).filter((h) => h.type === "stock" && h.live?.priceUSD != null);
  if (!stocks.length) { el.innerHTML = `<div class="rk-empty">USD hisse pozisyonu yok.</div>`; return; }
  const anySig = stocks.some((h) => h.sig && h.sig.rsi != null);

  const sgn = (v, d = 0, suf = "%") => (v == null || !isFinite(v) ? `<span class="pt-na">—</span>` : `<span class="${cls(v)}">${v >= 0 ? "+" : ""}${v.toFixed(d)}${suf}</span>`);

  const rows = stocks.map((h) => {
    const sig = h.sig || {};
    const sym = String(h.symbol).toUpperCase();
    const price = h.live.priceUSD;
    const cost = Number(h.costUSD) || null;
    const gainPct = sig.gainPct != null ? sig.gainPct : (cost ? ((price - cost) / cost) * 100 : null);

    // Sinyal rozeti (buildSignal'dan)
    const sg = sig.signal || null;
    const sgCls = sg ? (sg.tone === "buy" ? "pt-buy" : sg.tone === "sell" ? "pt-sell" : "pt-neutral") : "pt-neutral";
    const sgCell = sg ? `<span class="pt-sig ${sgCls}">${sg.label}</span>` : `<span class="pt-na">—</span>`;

    // RSI (>70 ısınmış kırmızı, <30 aşırı satım yeşil)
    const rsi = sig.rsi;
    const rsiCls = rsi == null ? "" : rsi >= 70 ? "neg" : rsi <= 30 ? "pos" : "";
    const rsiCell = rsi == null ? `<span class="pt-na">—</span>` : `<b class="${rsiCls}">${rsi.toFixed(0)}</b>`;

    // Trend: fiyat vs SMA50 / SMA200
    const a50 = sig.sma50 != null ? price >= sig.sma50 : null;
    const a200 = sig.sma200 != null ? price >= sig.sma200 : null;
    let trCell = `<span class="pt-na">—</span>`;
    if (a50 != null && a200 != null) {
      if (a50 && a200) trCell = `<span class="pt-tr pos" title="Fiyat SMA50 ve SMA200 üstünde — yükseliş trendi">▲ güçlü</span>`;
      else if (!a50 && !a200) trCell = `<span class="pt-tr neg" title="Fiyat SMA50 ve SMA200 altında — düşüş trendi">▼ zayıf</span>`;
      else trCell = `<span class="pt-tr warn" title="SMA50/200 arasında — kararsız">◆ karışık</span>`;
    } else if (a50 != null) trCell = a50 ? `<span class="pt-tr pos" title="SMA50 üstünde">▲</span>` : `<span class="pt-tr neg" title="SMA50 altında">▼</span>`;

    // Açık R = açık kâr / planlı risk (stop varsa)
    const stop = h.planStop ?? sig.swing?.stop ?? null;
    let rCell = `<span class="pt-na">—</span>`;
    if (cost && stop != null && cost - stop > 0) {
      const openR = (price - cost) / (cost - stop);
      rCell = `<b class="${cls(openR)}" title="Açık kârın ${Math.abs(openR).toFixed(1)} risk birimi (stop ${fmtUSD(stop)})">${openR >= 0 ? "+" : ""}${openR.toFixed(1)}R</b>`;
    }

    return `<tr>
      <td class="l"><b>${sym}</b></td>
      <td class="l">${sgCell}</td>
      <td>${rsiCell}</td>
      <td>${trCell}</td>
      <td>${sgn(sig.fromHighPct, 0)}</td>
      <td>${sgn(sig.upsidePct, 0)}</td>
      <td>${sgn(gainPct, 1)}</td>
      <td>${rCell}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div class="tbl-wrap"><table class="pt-table">
      <thead><tr>
        <th class="l">Sembol</th><th class="l">Sinyal</th>
        <th>RSI</th><th>Trend</th>
        <th>52h Zirve</th><th>Analist Hedef</th><th>K/Z</th>
        <th>Açık R</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="pt-note">${anySig
      ? "RSI &gt; 70 ısınmış · &lt; 30 aşırı satım. Trend = fiyatın SMA50/200'e göre yeri. 52h Zirve = 52 hafta zirvesinden uzaklık. Analist Hedef = ortalama hedefe potansiyel. Açık R = açık kârın stopuna göre kaç risk birimi (Kural 1)."
      : "Teknik veriler henüz taranıyor (RSI/SMA/52h analist). Birkaç dakika sonra tazele — ek API maliyeti olmadan günlük taramadan gelir."}</div>`;
}


