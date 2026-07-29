/**
 * Volcano Ark (火山方舟) — OpenAI-compatible chat for MT.
 * Speech uses browser ASR for now (方舟 key ≠ 语音 OpenAPI AK/SK).
 */

import { detectDirection } from "./audio-util.js";

export class VolcanoArkProvider {
  name = "volcano";

  constructor({ apiKey, model, baseUrl }) {
    if (!apiKey?.trim()) throw new Error("VOLC_ARK_API_KEY is required");
    if (!model?.trim()) {
      throw new Error("VOLC_ARK_MODEL（推理接入点 ep-...）is required");
    }
    this.apiKey = apiKey.trim();
    this.model = model.trim();
    this.baseUrl = (baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(
      /\/$/,
      "",
    );
  }

  async translateText({ sourceText, forceDirection }) {
    const text = String(sourceText || "").trim();
    if (!text) throw new Error("没有识别到有效文本");
    const direction = detectDirection(text, forceDirection);
    const target = direction === "zh2en" ? "English" : "简体中文";
    const system = `You are a bilingual conversation translator (Chinese ↔ English).
Return ONLY the translated text in ${target}. No quotes, no explanation.`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`火山方舟翻译失败 (${res.status}): ${detail.slice(0, 240)}`);
    }
    const data = await res.json();
    const translatedText = String(
      data?.choices?.[0]?.message?.content || "",
    ).trim();
    if (!translatedText) throw new Error("火山方舟翻译结果为空");
    return {
      sourceLang: direction === "zh2en" ? "zh" : "en",
      targetLang: direction === "zh2en" ? "en" : "zh",
      direction,
      sourceText: text,
      translatedText,
      detected: !forceDirection,
      provider: this.name,
    };
  }

  async transcribeAndTranslate() {
    throw new Error(
      "火山方舟当前仅接文本翻译；请打字，或切换到有道/讯飞做云端语音",
    );
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    throw new Error("火山模式请使用系统语音播报");
  }
}
