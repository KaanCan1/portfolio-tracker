/* guard-mail.js — Portföy Bekçisi günlük özet maili. Saf render, yan etkisi yok;
 * server.js'ten ayrı tutuluyor ki tek başına test edilebilsin (cash-target.js deseni).
 *
 * NEDEN VAR: bekçi eskiden her tetik için AYRI mail atıyordu. Yoğun bir günde
 * gelen kutusuna "NBIS portföyün %38'i", "AMD sıçradı", "MU stopunda" diye üç
 * ayrı mail düşüyordu; hiçbiri diğerinin bağlamını bilmiyordu ve önem sırası
 * gelme sırasına kalıyordu. Burası aynı taramanın bütün bulgularını TEK maile
 * toplar ve ÖNEM SIRASINA dizer: önce sermayeyi tehdit eden şey, sonra fırsat,
 * sonra bilgi.
 *
 * TASARIM KISITI — mail istemcisi tarayıcı değildir. Gmail/Outlook <style>
 * bloğunu, flexbox'ı, grid'i ve çoğu modern seçiciyi atar. Bu yüzden burada
 * her şey tablo yerleşimi + satır içi stildir; uygulamanın style.css'i burada
 * ÇALIŞMAZ, o yüzden Warm Paper + Deep Green paleti elle kopyalanmıştır. Palet
 * değişirse burası da elle güncellenir (bilinçli ikilik: alternatifi maile CSS
 * derleyen bir katman kurmaktı, bu kadar yüzey için aşırı).
 *
 * Emoji yok: arayüzdeki de-AI süpürmesiyle aynı çizgi. Önem sırası renkle,
 * kelimeyle ve yerleşimle anlatılır — süslemeyle değil. */

const C = {
  bg: "#f6f5f1", card: "#ffffff", line: "#e5e2d9", lineStrong: "#d3cfc2",
  ink: "#12140f", ink2: "#3c4238", muted: "#5f6457", soft: "#6e7366",
  hero: "#16211a", hero2: "#0b120e", green: "#1b6a40", greenSoft: "#e5f3e7", greenLine: "#cde4d3",
  red: "#d03238", redD: "#ab272c", redBg: "#faeae9", redLine: "#ebccc8",
  amber: "#c9871f", amberD: "#85670f", amberBg: "#f9f0da", amberLine: "#e9dcb8",
  sky: "#46688a", skyBg: "#e9eef1", skyLine: "#d5dde1",
};

/* Önem sırası: sermayeyi tehdit eden önce. Sıralama ve görsel ağırlık bu tablodan
 * türer — yeni bir uyarı tipi eklenince yalnız sev alanını doğru vermek yeter. */
const SEV = {
  crit: { rank: 0, label: "ACİL", fg: C.redD,   bg: C.redBg,   line: C.redLine,   dot: C.red,
          lead: "Sermayeni tehdit eden bulgular — önce bunlar." },
  warn: { rank: 1, label: "DİKKAT", fg: C.amberD, bg: C.amberBg, line: C.amberLine, dot: C.amber,
          lead: "Karar isteyen ama acil olmayan bulgular." },
  info: { rank: 2, label: "BİLGİ", fg: C.sky,   bg: C.skyBg,   line: C.skyLine,   dot: C.sky,
          lead: "Not düşülen, aksiyon beklemeyen bulgular." },
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const AY = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const trDate = (d) => `${d.getDate()} ${AY[d.getMonth()]} ${d.getFullYear()}`;

/* Konu satırı: gelen kutusunda AÇILMADAN okunabilmeli. "3 uyarı" hiçbir şey
 * söylemez; en ağır bulgu ne ise o yazılır. */
export function digestSubject(items, now = new Date()) {
  const n = { crit: 0, warn: 0, info: 0 };
  for (const it of items) n[it.sev in n ? it.sev : "info"]++;
  const d = `${now.getDate()} ${AY[now.getMonth()].slice(0, 3)}`;
  // Tek bulguda sembolü konuya taşı — "Planlı stopuna indi" hangi hisse olduğunu söylemiyor
  if (items.length === 1) {
    const it = items[0];
    return `Portföy Bekçisi — ${it.sym ? `${it.sym}: ` : ""}${it.title} (${d})`;
  }
  const parts = [];
  if (n.crit) parts.push(`${n.crit} acil`);
  if (n.warn) parts.push(`${n.warn} dikkat`);
  if (n.info) parts.push(`${n.info} bilgi`);
  // En ağır bulgu başa; ACİL varsa büyük harfle çünkü gelen kutusunda tek okunan yer burası
  const head = n.crit ? `${n.crit} ACİL` : parts[0];
  return `Portföy Bekçisi — ${[head, ...parts.slice(1)].join(" · ")} (${d})`;
}

/* Bir bulgu kartı. sym rozeti + tek büyük gerçek (headline) + sayı tablosu +
 * tavsiye kutusu. Büyük olan sayı, kararı belirleyen sayıdır. */
function card(it) {
  const s = SEV[it.sev] || SEV.info;
  const stats = (it.stats || []).filter((x) => x && x.value != null && x.value !== "");
  const statCells = stats.map((x) => `
        <td style="padding:0 18px 0 0;vertical-align:bottom">
          <div style="font:600 10px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:${C.soft}">${esc(x.label)}</div>
          <div style="font:600 15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink};white-space:nowrap">${esc(x.value)}</div>
        </td>`).join("");

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 12px">
    <tr>
      <td style="background:${C.card};border:1px solid ${C.line};border-left:3px solid ${s.dot};border-radius:10px;padding:16px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="vertical-align:middle">
              ${it.sym ? `<span style="display:inline-block;background:${C.hero};color:#ffffff;font:700 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:.5px;padding:6px 9px;border-radius:5px">${esc(it.sym)}</span>` : ""}
              <span style="font:600 10px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:${s.fg};${it.sym ? "margin-left:8px" : ""}">${esc(it.kindLabel || s.label)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:11px 0 0">
              <div style="font:600 17px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink}">${esc(it.title)}</div>
              ${it.headline ? `<div style="font:400 14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink2};padding-top:5px">${it.headline}</div>` : ""}
            </td>
          </tr>
          ${stats.length ? `<tr><td style="padding:14px 0 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${statCells}</tr></table>
          </td></tr>` : ""}
          ${it.action ? `<tr><td style="padding:14px 0 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="background:${s.bg};border:1px solid ${s.line};border-radius:8px;padding:12px 14px;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.ink2}">
                <span style="font-weight:700;color:${s.fg}">${esc(it.actionLabel || "Ne yapmalı")}:</span> ${it.action}
              </td></tr>
            </table>
          </td></tr>` : ""}
        </table>
      </td>
    </tr>
  </table>`;
}

/* Tüm bulguları tek maile toplar. items: {sev,kind,kindLabel,sym,title,headline,stats,action}[]
 * meta: {holdings, totalMV, trigger} — alt bilgideki tarama künyesi. */
export function digestHtml(items, meta = {}, now = new Date()) {
  const sorted = [...items].sort((a, b) => {
    const r = (SEV[a.sev] || SEV.info).rank - (SEV[b.sev] || SEV.info).rank;
    return r !== 0 ? r : String(a.sym || "").localeCompare(String(b.sym || ""), "tr");
  });
  const n = { crit: 0, warn: 0, info: 0 };
  for (const it of sorted) n[it.sev in n ? it.sev : "info"]++;

  /* Hero'daki tek cümle: maili açan kişi ilk saniyede "bugün ne oldu"yu bilmeli. */
  const lead = n.crit
    ? `${n.crit} bulgu sermayeni doğrudan ilgilendiriyor — en üstte.`
    : n.warn ? `Acil bir şey yok; ${n.warn} bulgu kararını bekliyor.`
    : "Acil ya da karar bekleyen bir şey yok.";

  const chip = (k) => {
    if (!n[k]) return "";
    const s = SEV[k];
    return `<td style="padding-right:8px"><span style="display:inline-block;background:${s.bg};border:1px solid ${s.line};color:${s.fg};font:700 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:.5px;padding:7px 11px;border-radius:20px">${n[k]} ${s.label}</span></td>`;
  };

  let body = "";
  for (const k of ["crit", "warn", "info"]) {
    const group = sorted.filter((x) => (x.sev in SEV ? x.sev : "info") === k);
    if (!group.length) continue;
    const s = SEV[k];
    body += `
    <tr><td style="padding:22px 0 10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle;width:9px"><span style="display:inline-block;width:7px;height:7px;background:${s.dot};border-radius:50%"></span></td>
        <td style="vertical-align:middle;padding-left:7px">
          <span style="font:700 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:1.1px;color:${s.fg}">${s.label}</span>
          <span style="font:400 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.soft};padding-left:9px">${esc(s.lead)}</span>
        </td>
      </tr></table>
    </td></tr>
    <tr><td>${group.map(card).join("")}</td></tr>`;
  }

  const kunye = [
    meta.holdings != null ? `${meta.holdings} hisse tarandı` : null,
    meta.totalMV ? `portföy ${meta.totalMV}` : null,
    `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} taraması`,
  ].filter(Boolean).join(" · ");

  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(lead)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.bg};margin:0;padding:0">
  <tr><td align="center" style="padding:26px 14px 40px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">

      <tr><td style="background:${C.hero};border-radius:12px;padding:26px 26px 24px">
        <div style="font:700 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#8fae9c">Portföy Bekçisi</div>
        <div style="font:600 25px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#ffffff;padding-top:9px">${esc(trDate(now))}</div>
        <div style="font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#b9cfc2;padding-top:7px">${esc(lead)}</div>
      </td></tr>

      <tr><td style="padding:16px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${chip("crit")}${chip("warn")}${chip("info")}</tr></table>
      </td></tr>

      ${body}

      <tr><td style="padding:16px 2px 0">
        <div style="font:400 12px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${C.soft}">
          ${esc(kunye)}<br>
          Kural 1: önce sermayeyi koru. Bu bir hatırlatmadır, emir değil — karar senin.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>`;
}
