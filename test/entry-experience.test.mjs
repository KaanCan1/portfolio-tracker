// 11 Eki 2026: giriş arayüzündeki ağ hatası veya çift tıklama kayıt kaybı üretmesin.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/js/14-entry-experience.js', import.meta.url), 'utf8');
function fixture(fetch) {
  const window = {};
  vm.runInNewContext(source, { window, fetch, TypeError, document: { readyState: 'loading', addEventListener() {} } });
  const target = { textContent: '', hidden: true };
  const submit = { disabled: false, textContent: 'Kaydet' };
  const close = { disabled: false };
  const unavailable = { disabled: true };
  const form = { dataset: {}, values: { symbol: 'NVDA', quantity: '5' },
    setAttribute() {}, removeAttribute() {},
    querySelector: (selector) => selector === '[data-entry-feedback]' ? target : submit,
    closest: () => ({ querySelectorAll: () => [submit, close, unavailable] }) };
  return { api: window.PortfolioEntry, form, target, submit, close, unavailable };
}
test('başarısız kayıt girilen bilgileri korur ve sunucu hatasını gösterir', async () => {
  const f = fixture(async () => ({ ok: false, json: async () => ({ error: 'Yetersiz nakit' }) }));
  let applied = false;
  assert.equal(await f.api.save(f.form, { url: '/api/holdings', body: f.form.values, onSuccess: () => { applied = true; } }), false);
  assert.equal(applied, false);
  assert.equal(f.target.textContent, 'Yetersiz nakit');
  assert.equal(f.target.hidden, false);
  assert.deepEqual(f.form.values, { symbol: 'NVDA', quantity: '5' });
  assert.equal(f.submit.disabled, false);
  assert.equal(f.submit.textContent, 'Kaydet');
  assert.equal(f.unavailable.disabled, true);
});
test('bekleyen kayda ikinci gönderim tek POST üretir', async () => {
  let release, calls = 0, applied = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const f = fixture(async () => { calls++; return pending; });
  const options = { url: '/api/trades', body: { symbol: 'NVDA', shares: 5 }, onSuccess: () => { applied++; } };
  const first = f.api.save(f.form, options);
  assert.equal(f.submit.disabled, true);
  assert.equal(f.close.disabled, true);
  assert.equal(await f.api.save(f.form, options), false);
  assert.equal(calls, 1);
  release({ ok: true, json: async () => ({ sync: '5 adet eklendi' }) });
  assert.equal(await first, true);
  assert.equal(applied, 1);
  assert.equal(f.submit.disabled, false);
  assert.equal(f.form.dataset.saving, undefined);
});
test('ağ hatasında düğmeler yeniden açılır; aynı form ile tekrar denenebilir', async () => {
  let failed = true;
  const f = fixture(async () => { if (failed) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => ({}) }; });
  const options = { url: '/api/holdings', body: f.form.values };
  assert.equal(await f.api.save(f.form, options), false);
  assert.match(f.target.textContent, /Bilgilerin burada duruyor/);
  assert.equal(f.submit.disabled, false);
  failed = false;
  assert.equal(await f.api.save(f.form, options), true);
  assert.equal(f.target.hidden, true);
});
test('başarılı yazmadan sonraki yenileme hatası kayıt hatası gibi gösterilmez', async () => {
  let writes = 0;
  const f = fixture(async () => { writes++; return { ok: true, json: async () => ({}) }; });
  await assert.rejects(f.api.save(f.form, { url: '/api/trades', body: {}, onSuccess: () => { throw new Error('Yenileme hatası'); } }), /Yenileme hatası/);
  assert.equal(writes, 1);
  assert.equal(f.target.hidden, true);
  assert.equal(f.submit.disabled, false);
});
