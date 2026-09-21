/* 10-overview.js — yeni Genel Bakış yalnız PortfolioDeskSnapshot sözleşmesini okur. */
(function portfolioDeskOverview() {
  "use strict";

  const host = document.getElementById("deskOverview");
  if (!host) return;
  // Tüm dashboard'un her fiyat yenilemesinde ekran okuyucuya tekrar okunmasını
  // önle; yalnız aşağıdaki küçük role=status / role=alert düğümleri canlıdır.
  host.removeAttribute("aria-live");

  const moneyTRY = (value) => value == null || !Number.isFinite(Number(value))
    ? "—"
    : "₺" + Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  const moneyUSD = (value) => value == null || !Number.isFinite(Number(value))
    ? "—"
    : "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const percent = (value) => value == null || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value) >= 0 ? "+" : ""}${Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const safe = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const tone = (value) => Number(value) > 0 ? "is-positive" : Number(value) < 0 ? "is-negative" : "is-neutral";

  let status = "loading";
  let errorMessage = "";

  function loadingTemplate() {
    return `<div class="desk-overview-state desk-overview-loading" role="status">
      <span class="desk-state-spinner" aria-hidden="true"></span>
      <div><b>Portföy hazırlanıyor</b><span>Fiyatlar, kur ve planlar aynı anda okunuyor.</span></div>
    </div>`;
  }

  function emptyTemplate() {
    return `<section class="desk-empty-state">
      <span class="desk-empty-icon" aria-hidden="true">↗</span>
      <div><p class="desk-kicker">BAŞLANGIÇ</p><h2>İlk pozisyonunu ekle</h2>
      <p>Portföy özeti, risk dağılımı ve öncelik listesi eklediğin gerçek verilerle oluşacak.</p></div>
      <button class="btn primary" type="button" data-desk-action="add">+ Varlık ekle</button>
    </section>`;
  }

  function allocationGradient(items) {
    if (!items.length) return "var(--desk-line, #e6eaee)";
    let cursor = 0;
    return `conic-gradient(${items.map((item) => {
      const from = cursor;
      cursor += item.pct;
      return `${item.color} ${from.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(",")})`;
  }

  function buildPriorities(snapshot) {
    const rows = [];
    for (const event of snapshot.feed?.events || []) {
      rows.push({
        key: `feed:${event.id || event.gid || event.ts}:${event.type}`,
        level: event.sev === "crit" ? 0 : event.sev === "warn" ? 1 : 2,
        eyebrow: event.sev === "crit" ? "KRİTİK GELİŞME" : event.type === "plan" ? "PLAN" : "YENİ GELİŞME",
        title: safe(event.title || "Yeni portföy olayı"),
        detail: safe(event.detail || (event.ts ? new Date(event.ts).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Ayrıntıyı incele")),
        action: event.type === "sig" ? "radar" : event.type === "alfa" ? "challenge" : event.type === "plan" ? "swing" : "positions",
      });
    }
    for (const alert of snapshot.alerts || []) {
      if (!alert.fired && !alert.near) continue;
      const condition = alert.type === "below" ? "alt sınır" : alert.type === "above" ? "üst sınır" : "günlük hareket";
      rows.push({
        key: `alert:${alert.id || alert.symbol}:${alert.type}`,
        level: alert.fired ? 0 : 1,
        eyebrow: alert.fired ? "ALARM TETİKLENDİ" : "ALARMA YAKIN",
        title: `${safe(alert.symbol)} · ${condition}`,
        detail: alert.price != null ? `Güncel ${moneyUSD(alert.price)}` : "Güncel fiyat bekleniyor",
        action: "positions",
      });
    }
    for (const earning of (snapshot.earnings || []).filter((item) => item.daysLeft <= 10)) {
      const when = earning.daysLeft === 0 ? "bugün" : `${earning.daysLeft} gün sonra`;
      rows.push({
        key: `earnings:${earning.symbol}:${earning.date}`,
        level: earning.daysLeft <= 2 ? 0 : 2,
        eyebrow: earning.horizon === "swing" ? "SWING · BİLANÇO RİSKİ" : "BİLANÇO",
        title: `${safe(earning.symbol)} · ${when}`,
        detail: earning.date ? new Date(`${earning.date}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) : "Tarih bekleniyor",
        action: "positions",
      });
    }
    return rows.sort((a, b) => a.level - b.level).filter((row, index, all) => all.findIndex((item) => item.key === row.key) === index).slice(0, 4);
  }

  function priorityContent(snapshot, priorities = buildPriorities(snapshot)) {
    const feedStatus = snapshot.feed?.status || "loading";
    const availability = feedStatus === "error"
      ? `<div class="desk-priority-availability is-error" role="status"><span aria-hidden="true">!</span><div><b>Gelişme akışı alınamadı</b><small>Alarm ve bilanço verileri gösteriliyor; yeni feed olayları doğrulanamadı.</small></div><button type="button" data-desk-action="retry-feed">Tekrar dene</button></div>`
      : feedStatus === "loading"
        ? `<div class="desk-priority-availability" role="status"><span class="desk-state-spinner" aria-hidden="true"></span><div><b>Gelişme akışı yükleniyor</b><small>Henüz “kritik olay yok” kararı verilmedi.</small></div></div>`
        : "";
    const rows = priorities.length
      ? priorities.map((item) => `<button class="desk-priority level-${item.level}" type="button" data-desk-action="${item.action}">
          <span class="desk-priority-mark" aria-hidden="true"></span><span><small>${item.eyebrow}</small><b>${item.title}</b><em>${item.detail}</em></span><i aria-hidden="true">→</i>
        </button>`).join("")
      : feedStatus === "ready"
        ? `<div class="desk-quiet-state"><span aria-hidden="true">✓</span><div><b>Şu an kritik öncelik yok</b><small>Alarm, feed ve yaklaşan bilanço olduğunda burada görünecek.</small></div></div>`
        : "";
    return availability + rows;
  }

  function updatePrioritySection(snapshot) {
    const list = host.querySelector(".desk-priority-list");
    const count = host.querySelector(".desk-priority-card .desk-count");
    if (!list || !count) return;
    const priorities = buildPriorities(snapshot);
    count.textContent = String(priorities.length);
    list.innerHTML = priorityContent(snapshot, priorities);
  }

  function render(snapshot) {
    if (!snapshot) {
      host.innerHTML = status === "error"
        ? `<div class="desk-overview-state desk-overview-error" role="alert"><b>Veri alınamadı</b><span>${safe(errorMessage || "Bağlantıyı kontrol edip yeniden deneyin.")}</span><button class="btn ghost sm" data-desk-action="retry">Yeniden dene</button></div>`
        : loadingTemplate();
      return;
    }

    const holdings = Array.isArray(snapshot.holdings) ? snapshot.holdings : [];
    const hasPortfolio = holdings.length > 0 || Number(snapshot.metrics?.cashTRY) !== 0;
    if (!hasPortfolio && snapshot.healthy) {
      host.innerHTML = emptyTemplate();
      syncPrivacy();
      return;
    }

    const fx = Number(snapshot.fx?.usdtry) || 0;
    const metrics = snapshot.metrics || {};
    const displayTotal = Number(snapshot.displayTotalTRY);
    const allocationTotal = Number(snapshot.allocation?.total) || 0;
    const allocation = (snapshot.allocation?.segs || []).map((item) => ({
      ...item,
      pct: allocationTotal > 0 ? (Number(item.value) / allocationTotal) * 100 : 0,
    }));
    const priorities = buildPriorities(snapshot);
    const largest = allocation[0] || null;
    const cash = allocation.find((item) => item.key === "cash");
    const firedAlerts = (snapshot.alerts || []).filter((item) => item.fired).length;
    const swing = typeof SWINGDECK !== "undefined" ? SWINGDECK : null;
    const proven = swing?._valid === false ? null : swing?.proven;
    const openSwing = (swing?.trades || []).filter((item) => item.status === "open");
    const upcoming = (snapshot.earnings || []).filter((item) => item.daysLeft >= 0 && item.daysLeft <= 30).slice(0, 4);
    const updated = snapshot.updatedAt ? new Date(snapshot.updatedAt) : null;
    const updateLabel = updated && !Number.isNaN(updated.getTime())
      ? updated.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      : "—";

    const health = snapshot.healthy
      ? `<div class="desk-health is-ok"><span aria-hidden="true">●</span> Veriler güncel <small>${updateLabel}</small></div>`
      : `<div class="desk-health is-warning"><span aria-hidden="true">!</span><div><b>Kısmi veri · son güvenilir toplam gösteriliyor</b>${(snapshot.healthIssues || []).map((item) => `<small>${safe(item)}</small>`).join("") || "<small>Bazı fiyatlar veya kurlar henüz doğrulanmadı.</small>"}</div></div>`;

    const priorityMarkup = priorityContent(snapshot, priorities);

    const allocationMarkup = allocation.length
      ? `<div class="desk-allocation-stage" id="deskAllocationVisual" aria-label="Varlık dağılımı görseli">
          <div class="desk-allocation-fallback" style="--desk-allocation:${allocationGradient(allocation)}"><span class="desk-sensitive">${moneyTRY(displayTotal)}</span><small>toplam</small></div>
        </div>
        <div class="desk-allocation-list">${allocation.map((item) => `<div><span class="desk-allocation-dot" style="--dot:${safe(item.color)}"></span><b>${safe(item.label)}</b><span>${item.pct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%</span><em class="desk-sensitive">${moneyTRY(item.value)}</em></div>`).join("")}</div>`
      : `<div class="desk-quiet-state"><div><b>Dağılım henüz oluşmadı</b><small>Değerlenmiş ilk varlıkla birlikte görünecek.</small></div></div>`;

    const upcomingMarkup = upcoming.length
      ? upcoming.map((item) => `<button type="button" class="desk-upcoming-row" data-desk-action="positions"><span class="desk-datebox"><b>${item.daysLeft === 0 ? "B" : item.daysLeft}</b><small>${item.daysLeft === 0 ? "bugün" : "gün"}</small></span><span><b>${safe(item.symbol)}</b><small>${safe(item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) : "Tarih bekleniyor")}</small></span><i>${item.horizon === "swing" ? "Swing" : "Pozisyon"}</i></button>`).join("")
      : `<div class="desk-quiet-state compact"><div><b>30 gün içinde bilanço yok</b><small>Takvim değiştiğinde liste kendini yeniler.</small></div></div>`;

    // WebGL renderer bu düğüme bağlıdır. 60 sn'lik portföy yenilemelerinde aynı
    // dağılım yüzeyini korumak context/texture churn'ünü engeller.
    const existingAllocationMount = document.getElementById("deskAllocationVisual");
    const existingThreeToggle = existingAllocationMount
      ?.closest(".desk-allocation-card")
      ?.querySelector(".desk-three-toggle");
    host.innerHTML = `
      ${health}
      <section class="desk-hero-grid">
        <article class="desk-total-card">
          <p class="desk-kicker">TOPLAM PORTFÖY</p>
          <div class="desk-total-value desk-sensitive">${fx ? moneyUSD(displayTotal / fx) : moneyTRY(displayTotal)}</div>
          <div class="desk-total-try desk-sensitive">${fx ? `≈ ${moneyTRY(displayTotal)}` : "Muhasebe para birimi TRY"}</div>
          <div class="desk-total-delta ${tone(metrics.dayPct)}"><span>${percent(metrics.dayPct)}</span> bugün</div>
          <button type="button" class="desk-text-action" data-desk-action="positions">Pozisyonları gör <span aria-hidden="true">→</span></button>
        </article>
        <div class="desk-metric-strip">
          <article><small>Açık pozisyon K/Z</small><b class="desk-sensitive ${tone(metrics.profitTRY)}">${fx ? moneyUSD(Number(metrics.profitTRY) / fx) : moneyTRY(metrics.profitTRY)}</b><span>${percent(metrics.profitPct)}</span></article>
          <article><small>Realize K/Z</small><b class="desk-sensitive ${tone(metrics.realizedUSD)}">${moneyUSD(metrics.realizedUSD)}</b><span>satışlardan</span></article>
          <article><small>Kanıtlanmış swing katkısı</small><b class="desk-sensitive ${tone(proven?.perMonth)}">${proven?.perMonth != null ? `${moneyUSD(proven.perMonth)}/ay` : "Ölçülmüyor"}</b><span>${swing?._valid === false ? "veri alınamadı" : proven?.verdict === "yetersiz" || !proven ? "yeterli örnek yok" : proven.verdict === "gurultu" ? "gürültüden ayrışmıyor" : "ölçülen katkı"}</span></article>
        </div>
      </section>

      <section class="desk-overview-grid">
        <article class="desk-surface desk-allocation-card">
          <header><div><p class="desk-kicker">DENGE</p><h2>Varlık dağılımı</h2></div><button type="button" class="desk-icon-action" data-desk-action="positions" aria-label="Pozisyonları aç">→</button></header>
          ${allocationMarkup}
        </article>
        <article class="desk-surface desk-priority-card">
          <header><div><p class="desk-kicker">BUGÜN</p><h2>Öncelikler</h2></div><span class="desk-count">${priorities.length}</span></header>
          <div class="desk-priority-list">${priorityMarkup}</div>
        </article>
      </section>

      <section class="desk-context-grid">
        <article class="desk-surface desk-risk-card">
          <header><div><p class="desk-kicker">RİSK BAĞLAMI</p><h2>Hızlı kontrol</h2></div><button type="button" class="desk-text-action" data-desk-action="analysis">Ayrıntı</button></header>
          <div class="desk-risk-list">
            <div><span>En büyük sınıf</span><b>${largest ? `${safe(largest.label)} · %${largest.pct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : "—"}</b></div>
            <div><span>Nakit payı</span><b>${cash ? `%${cash.pct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : "%0"}</b></div>
            <div><span>Tetiklenmiş alarm</span><b class="${firedAlerts ? "is-negative" : ""}">${firedAlerts}</b></div>
            <div><span>Açık swing planı</span><b>${openSwing.length}</b></div>
          </div>
        </article>
        <article class="desk-surface desk-upcoming-card">
          <header><div><p class="desk-kicker">TAKVİM</p><h2>Yaklaşan olaylar</h2></div><span class="desk-count">${upcoming.length}</span></header>
          <div class="desk-upcoming-list">${upcomingMarkup}</div>
        </article>
      </section>`;

    const replacementMount = document.getElementById("deskAllocationVisual");
    if (existingAllocationMount && replacementMount && existingAllocationMount !== replacementMount) {
      const oldFallback = existingAllocationMount.querySelector(".desk-allocation-fallback");
      const newFallback = replacementMount.querySelector(".desk-allocation-fallback");
      if (oldFallback && newFallback) {
        oldFallback.setAttribute("style", newFallback.getAttribute("style") || "");
        delete oldFallback.dataset.pm;
        oldFallback._pmOrig = null;
        const oldTotal = oldFallback.querySelector(".desk-sensitive");
        const newTotal = newFallback.querySelector(".desk-sensitive");
        if (oldTotal && newTotal) oldTotal.textContent = newTotal.textContent;
      }
      replacementMount.replaceWith(existingAllocationMount);
      if (existingThreeToggle) {
        existingAllocationMount
          .closest(".desk-allocation-card")
          ?.querySelector(":scope > header")
          ?.append(existingThreeToggle);
      }
    }

    syncPrivacy();
  }

  function syncPrivacy() {
    const on = document.body.classList.contains("privacy");
    const button = document.getElementById("deskPrivacy");
    if (button) {
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.setAttribute("aria-label", on ? "Tutarları göster" : "Tutarları gizle");
      button.textContent = on ? "Tutarları göster" : "Gizlilik";
    }
    if (typeof maskEl === "function" && typeof unmaskEl === "function") {
      document.querySelectorAll(".desk-sensitive").forEach(on ? maskEl : unmaskEl);
    }
  }

  function refresh() {
    status = window.PortfolioDeskSnapshot ? "ready" : status;
    render(window.PortfolioDeskSnapshot || null);
  }

  host.addEventListener("click", (event) => {
    const action = event.target.closest("[data-desk-action]")?.dataset.deskAction;
    if (!action) return;
    if (action === "retry") { if (typeof load === "function") load(); return; }
    if (action === "retry-feed") { if (typeof loadFeed === "function") loadFeed(); return; }
    if (action === "add") { if (typeof openAdd === "function") openAdd(); return; }
    const view = { positions: "pozisyonlar", analysis: "analiz", swing: "swingdefteri", radar: "radar", challenge: "challenge" }[action];
    if (view && typeof showView === "function") showView(view);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("#deskPrivacy")) {
      if (typeof applyPrivacy === "function") applyPrivacy(!document.body.classList.contains("privacy"));
      syncPrivacy();
    } else if (event.target.closest("#privacyToggle")) {
      queueMicrotask(syncPrivacy);
    }
  });
  window.addEventListener("portfolio:loading", () => {
    if (!window.PortfolioDeskSnapshot) { status = "loading"; render(null); }
  });
  window.addEventListener("portfolio:error", (event) => {
    if (!window.PortfolioDeskSnapshot) {
      status = "error";
      errorMessage = event.detail?.message || "Portföy verisine ulaşılamadı.";
      render(null);
    }
  });
  window.addEventListener("portfolio:updated", (event) => {
    status = "ready";
    render(event.detail || window.PortfolioDeskSnapshot);
  });
  window.addEventListener("portfolio:feed", (event) => {
    if (!window.PortfolioDeskSnapshot) return;
    window.PortfolioDeskSnapshot.feed = event.detail || { status: "error", events: [] };
    updatePrioritySection(window.PortfolioDeskSnapshot);
  });

  window.PortfolioDesk = { refresh, syncPrivacy };
  refresh();
})();
