/* ============================ FX — animasyon katmanı ============================
 * Hareket dili: sekme giriş koreografisi + kaydırırken ince belirme (scroll-reveal)
 * + dolum/pop dokunuşları. app.js'e DOKUNMAZ — DOM'u dışarıdan gözler.
 *
 * Disiplin (craft/animation-discipline):
 *  - prefers-reduced-motion: reduce → tüm koreografi kapalı
 *  - Giriş animasyonları yalnız KULLANICI GEZİNMESİ penceresinde kurulur (~1.6s);
 *    arka plan veri yenilemeleri (60s poll) sessizdir — dikkat çelmez.
 *  - Scroll-reveal: yalnız o gezinmede ekran DIŞINDA kalan bloklar, görünüme
 *    girerken bir kez yumuşakça belirir (IntersectionObserver, sonra bırakılır).
 */
(() => {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => RM.matches;

  /* ---------------- gezinme penceresi: animasyonlar yalnız nav sonrası ---------------- */
  let navAt = performance.now(); // ilk yükleme de bir "gezinme"dir
  const navFresh = () => performance.now() - navAt < 1600;
  const bumpNav = () => { navAt = performance.now(); };
  document.addEventListener("click", (e) => {
    if (e.target.closest(".nav-item,[data-view],.vj-chip,.segm,[data-hunt]")) bumpNav();
  }, true);
  window.addEventListener("hashchange", bumpNav);
  // Teşhis: konsoldan __FX_DEBUG() → gezinme penceresi durumu
  window.__FX_DEBUG = () => ({ navAt, fresh: navFresh(), now: performance.now() });

  /* Blok seçicileri: dış koreografi EN DIŞ blokları, scroll-reveal YAPRAK blokları kullanır
   * (Alfa Avı gibi tek dev panelli sekmelerde iç kartlar da tek tek belirsin). */
  const BLOCK_SEL = ".panel, .card, .db-card, .ch-kpi, .rai-panel, .tbl-wrap, .ri-card, .ch-card, .note-card, .sw-pos, .ch-goal, .ch-regime, .ch-strat, .dj-cell, .r26-stat, .sx-stat";
  const BAR_SEL = ".ch-goalfill, .rai-fill, .goalfill, .lg-bar i, .rb-bar i, .rk-health-fill, .chl-seg";

  /* Dolum çubukları: inline width'i 0'dan hedefe süz (fx-hide içindekiler reveal anına bırakılır) */
  function fillBars(scope) {
    scope.querySelectorAll(BAR_SEL).forEach((el) => {
      const w = el.style.width;
      if (!w || el.dataset.fxBar === String(navAt) || el.closest(".fx-hide")) return;
      el.dataset.fxBar = String(navAt);
      el.style.transition = "none"; el.style.width = "0%";
      void el.offsetWidth;
      el.style.transition = "width .9s cubic-bezier(.22,1,.36,1)";
      el.style.width = w;
    });
  }

  /* Donut + gösterge: yumuşak dönüş-büyüme girişi */
  function popCharts(scope) {
    scope.querySelectorAll("svg.donut, svg.fng-gauge").forEach((el) => {
      if (el.dataset.fxPop === String(navAt) || el.closest(".fx-hide")) return;
      el.dataset.fxPop = String(navAt);
      el.classList.remove("fx-pop"); void el.getBoundingClientRect();
      el.classList.add("fx-pop");
      el.addEventListener("animationend", () => el.classList.remove("fx-pop"), { once: true });
    });
  }

  /* ---------------- scroll-reveal: ekrana girerken ince belirme ----------------
   * Çift tetik: IntersectionObserver (birincil) + throttle'lı scroll taraması
   * (yedek — IO'nun render'a bağlı geciktiği uçlarda bile belirme kaçmaz). */
  const pending = new Set(); // fx-hide bekleyen bloklar
  function revealNow(el) {
    pending.delete(el); io.unobserve(el);
    el.classList.add("fx-reveal");
    const done = () => el.classList.remove("fx-hide", "fx-reveal");
    el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 950);                         // transitionend kaçarsa kalıntı kalmasın
    fillBars(el); popCharts(el);                   // içindeki çubuk/donut da o an dolsun
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) revealNow(en.target);
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });

  function sweep() { // görünüme girmiş bekleyenleri elle yakala (IO yedeği) + kopuk budama
    for (const el of [...pending]) {
      if (!el.isConnected) { pending.delete(el); io.unobserve(el); continue; }
      if (el.offsetParent === null) continue;      // gizli sekmedeki view — bekle
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * .96 && r.bottom > -20) revealNow(el);
    }
  }
  let swT = 0;
  const sweepSoon = () => { if (!swT) swT = setTimeout(() => { swT = 0; sweep(); }, 130); };
  window.addEventListener("scroll", sweepSoon, { passive: true });
  window.addEventListener("resize", sweepSoon);
  window.__FX_SWEEP = sweep; // teşhis: elle tarama

  function prepScrollReveal(leaves) {
    for (const el of [...pending]) if (!el.isConnected) { pending.delete(el); io.unobserve(el); } // budama
    let n = 0;
    for (const el of leaves) {
      if (pending.size + n >= 60) break;           // maliyet sınırı
      el.classList.add("fx-hide");
      pending.add(el);
      io.observe(el);
      n++;
    }
  }

  /* ---------------- sekme giriş koreografisi (kademeli reveal) ---------------- */
  let firstPaintDone = false; // soğuk yüklemede ilk dolu render 1.6s'i aşabilir → onu da gezinme say
  function staggerView(view) {
    if (reduced()) return;
    const all = [...view.querySelectorAll(BLOCK_SEL)];
    if (!all.length) return;                               // içerik henüz render olmadı
    if (!firstPaintDone) { firstPaintDone = true; bumpNav(); }
    const tok = String(navAt);
    const vh = innerHeight || 800;

    // 1) Görünürdeki EN DIŞ bloklar → giriş koreografisi (YALNIZ gezinme penceresi, nav başına BİR kez)
    if (navFresh() && view.dataset.fxTok !== tok) {
      view.dataset.fxTok = tok;
      // önceki gezinmeden bekleyen scroll-reveal işaretlerini sıfırla (aynı flush'ta yeniden kurulur)
      view.querySelectorAll(".fx-hide, .fx-reveal").forEach((el) => { el.classList.remove("fx-hide", "fx-reveal"); io.unobserve(el); pending.delete(el); delete el.dataset.fxSc; });
      const tops = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
      const inView = tops.filter((el) => { const r = el.getBoundingClientRect(); return r.top < vh * .94 && r.bottom > 0; }).slice(0, 18);
      inView.forEach((el, i) => {
        el.style.setProperty("--fx-d", (i * 48) + "ms");
        el.classList.remove("fx-in");
        void el.offsetWidth;
        el.classList.add("fx-in");
        el.addEventListener("animationend", () => el.classList.remove("fx-in"), { once: true });
        setTimeout(() => el.classList.remove("fx-in"), 1500 + i * 48); // will-change kalıntısı kalmasın
      });
      fillBars(view);
      popCharts(view);
    }

    // 2) YAPRAK bloklar (başka blok içermeyen) + ekran dışındakiler → scroll-reveal hazırlığı.
    //    Zaman penceresine BAĞLI DEĞİL: fold-altı işaretleme görünmez bir hazırlıktır; çok aşamalı
    //    ilk yükleme ve 60s poll yenilemeleri de yeni öğelerini kaydırınca ince belirtir.
    //    Öğe-ömrü işareti (fxSc): aynı öğe bir kez hazırlanır; render yenisini getirirse o da hazırlanır.
    const leaves = all.filter((el) => !all.some((o) => o !== el && el.contains(o)))
      .filter((el) => el.dataset.fxSc !== "1" && !el.classList.contains("fx-hide"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.top >= vh * .94; });
    leaves.forEach((el) => { el.dataset.fxSc = "1"; });
    prepScrollReveal(leaves);
  }

  /* Aktif view'ı izle. max-wait'li debounce: sık mutasyon trenleri (ör. animasyon sınıfı
   * temizlikleri) sade debounce'ı sonsuz erteleyebilir → en geç 260ms'de flush garanti. */
  const debounceMax = (fn, ms, max) => {
    let t = 0, first = 0;
    return () => {
      const now = performance.now();
      if (!first) first = now;
      clearTimeout(t);
      if (now - first >= max) { first = 0; fn(); return; }
      t = setTimeout(() => { first = 0; fn(); }, ms);
    };
  };
  const onDom = debounceMax(() => {
    const v = document.querySelector(".view.active");
    if (v) staggerView(v);
  }, 90, 260);
  new MutationObserver(onDom).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  /* ilk boya */
  onDom();
})();
