/* ============================ FX — animasyon katmanı ============================
 * open-design geçişinin hareket dili: three.js hero sahnesi + sekme giriş
 * koreografisi + bar/donut dolumları. app.js'e DOKUNMAZ — DOM'u gözler.
 *
 * Disiplin (craft/animation-discipline):
 *  - prefers-reduced-motion: reduce → koreografi kapalı, hero tek kare (statik)
 *  - Animasyonlar yalnız KULLANICI GEZİNMESİ penceresinde oynar (~1.6s);
 *    arka plan veri yenilemeleri (60s poll) sessizdir — dikkat çelmez.
 *  - Hero WebGL: DPR ≤ 1.75, görünmezken/gizli sekmede RAF durur (pil dostu).
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

  /* ---------------- 1) Sekme giriş koreografisi (kademeli reveal) ---------------- */
  const BLOCK_SEL = ".panel, .card, .db-card, .ch-kpi, .rai-panel, .tbl-wrap, .ri-card, .ch-card, .note-card, .sw-pos";
  function staggerView(view) {
    if (reduced() || !navFresh()) return;
    if (view.dataset.fxTok === String(navAt)) return;      // bu gezinmede zaten oynadı
    const all = [...view.querySelectorAll(BLOCK_SEL)];
    if (!all.length) return;                               // içerik henüz render olmadı
    view.dataset.fxTok = String(navAt);
    // yalnız EN DIŞ bloklar (iç içe kart çift oynamasın), ekranda ilk ~18 öğe
    const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el))).slice(0, 18);
    top.forEach((el, i) => {
      el.style.setProperty("--fx-d", (i * 48) + "ms");
      el.classList.remove("fx-in");            // tekrar tetiklenebilsin
      void el.offsetWidth;                     // reflow → animasyon resetlenir
      el.classList.add("fx-in");
      el.addEventListener("animationend", () => el.classList.remove("fx-in"), { once: true });
      setTimeout(() => el.classList.remove("fx-in"), 1500 + i * 48); // animationend kaçarsa will-change kalıntısı kalmasın
    });
    fillBars(view);
    popCharts(view);
  }

  /* Dolum çubukları: inline width'i 0'dan hedefe süz */
  const BAR_SEL = ".ch-goalfill, .rai-fill, .goalfill, .lg-bar i, .rb-bar i, .rk-health-fill, .chl-seg";
  function fillBars(view) {
    view.querySelectorAll(BAR_SEL).forEach((el) => {
      const w = el.style.width;
      if (!w || el.dataset.fxBar === String(navAt)) return;
      el.dataset.fxBar = String(navAt);
      el.style.transition = "none"; el.style.width = "0%";
      void el.offsetWidth;
      el.style.transition = "width .9s cubic-bezier(.22,1,.36,1)";
      el.style.width = w;
    });
  }

  /* Donut + gösterge: yumuşak dönüş-büyüme girişi */
  function popCharts(view) {
    view.querySelectorAll("svg.donut, svg.fng-gauge").forEach((el) => {
      if (el.dataset.fxPop === String(navAt)) return;
      el.dataset.fxPop = String(navAt);
      el.classList.remove("fx-pop"); void el.getBoundingClientRect();
      el.classList.add("fx-pop");
      el.addEventListener("animationend", () => el.classList.remove("fx-pop"), { once: true });
    });
  }

  /* Aktif view'ı izle: nav'da .active değişir; içerik async render olur → her ikisi de yakalanır.
   * max-wait'li debounce: sık mutasyon trenleri (ör. animasyon sınıfı temizlikleri) sade debounce'ı
   * sonsuz erteleyebilir → en geç 260ms'de bir flush garanti edilir. */
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
    mountHero();
  }, 90, 260);
  new MutationObserver(onDom).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  /* ---------------- 2) Hero — three.js "akan ipek" sahnesi ---------------- */
  /* Koyu yeşil hero kartının içinde, rakamların ALTINDA yaşayan sakin dalga örtüsü.
   * Tek renderer + tek canvas: render() innerHTML'i tazelese de canvas yeniden
   * iliştirilir (GL bağlamı sızmaz). */
  let FXH = null;
  function heroHost() { return document.querySelector("#view-genel .card.hero"); }
  function mountHero() {
    if (!window.THREE) return;
    const host = heroHost();
    if (!host) { if (FXH) FXH.pause(); return; }
    if (!FXH) FXH = buildHero();
    if (!host.contains(FXH.cvs)) {
      host.classList.add("fx-hero-host");
      host.prepend(FXH.cvs);
      FXH.fit(host);
    }
    FXH.play();
  }

  function buildHero() {
    const T = window.THREE;
    const cvs = document.createElement("canvas");
    cvs.className = "fx-hero-canvas";
    const renderer = new T.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 2, 0.1, 60);
    camera.position.set(0, -7.2, 5.6);
    camera.lookAt(0, 0, 0);

    const uni = { uT: { value: 0 }, uAmp: { value: 1 } };
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: uni,
      vertexShader: `
        uniform float uT; uniform float uAmp;
        varying float vH; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w1 = sin(p.x * .52 + uT * .55) * cos(p.y * .68 + uT * .40);
          float w2 = sin((p.x + p.y) * .34 - uT * .33);
          float w3 = sin(p.x * 1.30 - uT * .21) * .35;
          float z = (w1 * .9 + w2 * .68 + w3) * uAmp;
          vH = z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p.xy, z, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        varying float vH; varying vec2 vUv;
        void main() {
          vec3 deep = vec3(.031, .067, .047);   /* #081108 ailesi — kart zeminine erir */
          vec3 mid  = vec3(.078, .224, .141);   /* #143924 */
          vec3 rim  = vec3(.184, .561, .341);   /* #2f8f57 marka yeşili */
          float h = clamp(vH * .5 + .5, 0., 1.);
          vec3 col = mix(deep, mid, smoothstep(.15, .78, h));
          col = mix(col, rim, smoothstep(.82, 1.0, h) * .55);
          /* kenarlara doğru şeffaflaş → kartın kendi gradyanına karışır */
          float vig = smoothstep(0., .18, vUv.x) * smoothstep(1., .82, vUv.x)
                    * smoothstep(0., .22, vUv.y) * smoothstep(1., .70, vUv.y);
          gl_FragColor = vec4(col, vig * .78);
        }`,
    });
    const geo = new T.PlaneGeometry(26, 15, 110, 64);
    const mesh = new T.Mesh(geo, mat);
    mesh.rotation.x = -0.92;
    scene.add(mesh);

    let raf = 0, visible = true, t0 = performance.now();
    let px = 0, py = 0, tx = 0, ty = 0; // pointer parallax (lerp)
    const tick = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      window.__FX_FRAMES = (window.__FX_FRAMES || 0) + 1; // teşhis: canlı kare sayacı
      uni.uT.value = (performance.now() - t0) / 1000;
      px += (tx - px) * .04; py += (ty - py) * .04;
      camera.position.x = px * .55;
      camera.position.z = 5.6 + py * .3;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      if (!reduced()) raf = requestAnimationFrame(tick);
    };
    const play = () => { if (!raf) { raf = requestAnimationFrame(tick); } };
    const pause = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    // Teşhis kancası: gizli sekmede RAF koşmaz → sahneyi elle ilerletip tek kare bas
    window.__FX_STEP = (ms) => { uni.uT.value += (ms || 500) / 1000; renderer.render(scene, camera); return uni.uT.value; };

    const fit = (host) => {
      const w = host.clientWidth || 600, h = host.clientHeight || 320;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera); // reduced-motion'da da tek temiz kare
    };
    new ResizeObserver(() => { const h = heroHost(); if (h && h.contains(cvs)) fit(h); }).observe(document.body);
    new IntersectionObserver((es) => { visible = es[0]?.isIntersecting !== false; if (visible) play(); }, { threshold: 0 }).observe(cvs);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) play(); });
    document.addEventListener("pointermove", (e) => {
      const host = heroHost(); if (!host || !host.contains(cvs)) return;
      const r = host.getBoundingClientRect();
      if (e.clientX < r.left - 80 || e.clientX > r.right + 80 || e.clientY < r.top - 80 || e.clientY > r.bottom + 80) return;
      tx = ((e.clientX - r.left) / r.width - .5) * 2;
      ty = ((e.clientY - r.top) / r.height - .5) * 2;
    }, { passive: true });
    RM.addEventListener?.("change", () => { if (!reduced()) play(); });

    return { cvs, fit, play, pause };
  }

  /* ilk boya */
  onDom();
})();
