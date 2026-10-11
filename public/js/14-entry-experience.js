/* 11 Eki 2026: başarısız kayıt formu silmesin; aynı tıklama iki işlem üretmesin. */
(function portfolioEntryExperience() {
  "use strict";
  function feedback(form, message) {
    const target = form.querySelector("[data-entry-feedback]");
    if (!target) return;
    target.textContent = message || "";
    target.hidden = !message;
  }
  function reset(form) { feedback(form, ""); }
  function notify(message) {
    let target = document.getElementById("entryToast");
    if (!target) {
      target = document.createElement("div");
      target.id = "entryToast";
      target.setAttribute("role", "status");
      document.body.append(target);
    }
    target.textContent = message;
    target.hidden = false;
    clearTimeout(target._timer);
    target._timer = setTimeout(() => { target.hidden = true; }, 5000);
  }
  async function save(form, { url, method = "POST", body, onSuccess }) {
    if (form.dataset.saving === "true") return false;
    feedback(form, "");
    form.dataset.saving = "true";
    form.setAttribute("aria-busy", "true");
    const buttons = [...form.closest(".modal").querySelectorAll("button")];
    const disabled = buttons.map((button) => button.disabled);
    const submit = form.querySelector('[type="submit"]');
    const label = submit.textContent;
    buttons.forEach((button) => { button.disabled = true; });
    submit.textContent = "Kaydediliyor…";
    let response;
    try {
      const result = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      response = await result.json();
      if (!result.ok) throw new Error(response.error || "Kayıt tamamlanamadı. Bilgilerini kontrol edip tekrar dene.");
    } catch (error) {
      feedback(form, error instanceof TypeError ? "Bağlantı kurulamadı. Bilgilerin burada duruyor; yeniden deneyebilirsin." : error.message);
      return false;
    } finally {
      delete form.dataset.saving;
      form.removeAttribute("aria-busy");
      buttons.forEach((button, index) => { button.disabled = disabled[index]; });
      submit.textContent = label;
    }
    // Başarılı yazma ve ekran yenileme ayrı: yenileme sorunu yeniden kayıt yaptırmamalı.
    await onSuccess?.(response);
    return true;
  }
  window.PortfolioEntry = { save, reset, feedback, notify };

  function init() {
    const holding = document.getElementById("holdingForm");
    const field = (name) => holding.elements.namedItem(name);
    function updateHolding() {
      const type = field("type").value;
      const editing = !!field("id").value;
      const quantity = Number(field("quantity").value);
      const price = Number(field("costUSD").value);
      const totalTRY = Number(field("costTRY").value);
      const symbol = field("symbol").value.trim().toUpperCase();
      const summary = document.getElementById("holdingPreview");
      summary.replaceChildren();
      const label = document.createElement("small");
      label.textContent = editing ? "GÜNCELLENEN POZİSYON" : "EKLENECEK POZİSYON";
      const main = document.createElement("strong");
      main.textContent = quantity > 0 ? `${quantity.toLocaleString("tr-TR", { maximumFractionDigits: 8 })} ${type === "gold" ? "gram" : "adet"}${symbol ? ` · ${symbol}` : ""}` : "Miktarı gir, özetini burada gör";
      const detail = document.createElement("span");
      const amount = type === "stock" && price > 0 ? `$${(quantity * price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : totalTRY > 0 ? `₺${totalTRY.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}` : null;
      detail.textContent = amount ? `Alış maliyeti ${amount}${type === "stock" && !editing ? " · alış ve nakit kaydı oluşturulur" : ""}` : "Maliyet isteğe bağlı; eklediğinde kâr / zarar hesabında kullanılır.";
      const note = document.createElement("span");
      note.className = "entry-hint";
      note.textContent = editing ? "Adet alanı, pozisyonunun yeni toplam adedidir." : "Aynı varlık varsa bu miktar mevcut pozisyonuna eklenir.";
      summary.append(label, main, detail, note);
      document.getElementById("holdingSaveBtn").textContent = editing ? "Değişiklikleri kaydet" : "Varlığı ekle";
      document.getElementById("costTryLabel").hidden = type === "stock" && !editing;
      // Bir türün eski maliyeti başka türün girişine taşınmasın; stock TL maliyeti düzenlemede korunur.
      document.getElementById("symbolCaption").textContent = { stock: "Hisse sembolü", fund: "Fon kodu", gold: "Altın kodu" }[type];
      field("symbol").placeholder = { stock: "Örn. NVDA", fund: "Örn. PHE", gold: "GRA" }[type];
      document.getElementById("symbolHint").textContent = type === "gold" ? "Gram altın için GRA kodunu kullanabilirsin." : "Sembolü yaz veya önerilerden seç.";
      document.querySelectorAll("#typePills button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.type === type)));
      document.querySelectorAll("#hzPills button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.hz === field("horizon").value)));
    }
    holding.addEventListener("input", updateHolding);
    holding.addEventListener("change", updateHolding);
    document.getElementById("typePills").addEventListener("click", updateHolding);
    document.getElementById("hzPills").addEventListener("click", updateHolding);
    const trade = document.getElementById("tradeForm");
    document.getElementById("tradeKindPills").addEventListener("click", (event) => {
      const button = event.target.closest("[data-kind]");
      if (!button) return;
      trade.elements.kind.value = button.dataset.kind;
      toggleTradeKind();
    });
    trade.elements.symbol.addEventListener("change", () => {
      const symbol = trade.elements.symbol.value.trim().toUpperCase();
      trade.elements.symbol.value = symbol;
      const existing = STATE.holdings.find((item) => item.type === "stock" && item.symbol === symbol);
      trade.elements.name.value = existing?.name || "";
      if (trade.elements.kind.value === "sell") trade.elements.buyUSD.value = existing?.costUSD ?? "";
      updateTradePreview();
    });

    const backgrounds = ["modalBg", "tradeModalBg", "swingModalBg", "flowModalBg"].map((id) => document.getElementById(id));
    let active = null, returnFocus = null;
    function close(background) {
      if (background.querySelector('[data-saving="true"]')) return;
      background.hidden = true;
    }
    backgrounds.forEach((background) => {
      const dialog = background.querySelector(".modal");
      const heading = dialog.querySelector("h3");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", heading.id);
      dialog.classList.add("entry-modal");
      if (!dialog.querySelector("[data-entry-close]")) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "entry-close";
        button.dataset.entryClose = "";
        button.setAttribute("aria-label", "Pencereyi kapat");
        button.textContent = "×";
        heading.after(button);
      }
      dialog.querySelector("[data-entry-close]").addEventListener("click", () => close(background));
      new MutationObserver(() => {
        if (!background.hidden) {
          returnFocus = document.activeElement;
          active = background;
          document.body.classList.add("entry-open");
          reset(background.querySelector("form"));
          if (background.id === "modalBg") updateHolding();
          if (background.id === "tradeModalBg") updateTradePreview();
          const first = dialog.querySelector('input:not([type="hidden"]), select:not([hidden])');
          first?.focus();
        } else if (active === background) {
          active = null;
          document.body.classList.remove("entry-open");
          if (returnFocus?.isConnected) returnFocus.focus();
          else document.getElementById("deskPrimaryAction")?.focus();
        }
      }).observe(background, { attributes: true, attributeFilter: ["hidden"] });
    });
    document.addEventListener("keydown", (event) => {
      if (!active) return;
      if (event.key === "Escape") { event.preventDefault(); close(active); return; }
      if (event.key !== "Tab") return;
      const focusable = [...active.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')].filter((element) => !element.disabled && element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
