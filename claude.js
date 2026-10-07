/* claude.js — yapılandırılmış çıktılı tek Claude çağrısı.
 * server.js'ten ayrıldı ki eval betiği (scripts/rag-eval.mjs) sunucuyla AYNI
 * çağrıyı yapsın; eval'in ölçtüğü şey canlıda koşan şeyle aynı olmalı.
 *
 * Yapılandırılmış çıktı: output_config.format (json_schema) → yanıt her zaman
 * şemaya uyan saf JSON; UI serbest metin ayrıştırmaz. */
export function askClaudeOlustur({ istemci, model }) {
  return async function askClaude({ system, payload, schema, maxTokens = 16000 }) {
    const r = await istemci().messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: JSON.stringify(payload, null, 1) }],
    });
    if (r.stop_reason === "refusal") throw new Error("Claude isteği güvenlik gerekçesiyle reddetti");
    const txt = (r.content || []).find((b) => b.type === "text")?.text || "";
    return { result: JSON.parse(txt), model: r.model, usage: { in: r.usage?.input_tokens, out: r.usage?.output_tokens } };
  };
}
