/**
 * Translation providers:
 * - googlegtx / local: free unofficial Google translate endpoint
 * - mymemory: free text MT fallback
 * - youdao: Youdao Zhiyun text MT + short ASR
 * - xunfei: iFlytek MT + IAT ASR
 * - mock: offline stub
 * - openai: cloud ASR + MT + TTS when OPENAI_API_KEY is set
 */

import { createHash, randomUUID } from "node:crypto";
import { convertToWav16kMono, detectDirection } from "./audio-util.js";
import { XunfeiProvider } from "./xunfei.js";
import { VolcanoArkProvider } from "./volcano.js";

export { detectDirection } from "./audio-util.js";

export function createProvider({
  name,
  apiKey,
  baseUrl,
  youdaoAppKey,
  youdaoAppSecret,
  xunfeiAppId,
  xunfeiApiKey,
  xunfeiApiSecret,
  volcanoArkApiKey,
  volcanoArkModel,
  volcanoArkBaseUrl,
}) {
  if (name === "mock") return new MockProvider();
  if (name === "googlegtx") return new GoogleGtxProvider();
  if (name === "mymemory") return new MyMemoryProvider();
  if (name === "youdao") {
    return new YoudaoProvider({
      appKey: youdaoAppKey,
      appSecret: youdaoAppSecret,
    });
  }
  if (name === "xunfei") {
    return new XunfeiProvider({
      appId: xunfeiAppId,
      apiKey: xunfeiApiKey,
      apiSecret: xunfeiApiSecret,
    });
  }
  if (name === "volcano") {
    return new VolcanoArkProvider({
      apiKey: volcanoArkApiKey,
      model: volcanoArkModel,
      baseUrl: volcanoArkBaseUrl,
    });
  }
  if (name === "openai") return new OpenAIProvider({ apiKey, baseUrl });
  throw new Error(`Unknown provider: ${name}`);
}

function pack(sourceText, direction, { detected, provider }) {
  return {
    sourceLang: direction === "zh2en" ? "zh" : "en",
    targetLang: direction === "zh2en" ? "en" : "zh",
    direction,
    sourceText,
    translatedText: "",
    detected,
    provider,
  };
}

class MockProvider {
  name = "mock";

  async translateText({ sourceText, forceDirection }) {
    const direction = detectDirection(sourceText, forceDirection);
    const base = pack(sourceText, direction, {
      detected: !forceDirection,
      provider: this.name,
    });
    base.translatedText =
      direction === "zh2en" ? `[EN] ${sourceText}` : `[中文] ${sourceText}`;
    return base;
  }

  async transcribeAndTranslate({ forceDirection }) {
    const direction = forceDirection || (Math.random() > 0.5 ? "zh2en" : "en2zh");
    if (direction === "zh2en") {
      return {
        sourceLang: "zh",
        targetLang: "en",
        direction: "zh2en",
        sourceText: "你好，请问洗手间在哪里？",
        translatedText: "Hi, where is the restroom?",
        detected: !forceDirection,
        provider: this.name,
      };
    }
    return {
      sourceLang: "en",
      targetLang: "zh",
      direction: "en2zh",
      sourceText: "The restroom is down the hall on the left.",
      translatedText: "洗手间在走廊尽头左手边。",
      detected: !forceDirection,
      provider: this.name,
    };
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    const buffer = buildSilentWav(0.4);
    return { buffer, contentType: "audio/wav" };
  }
}

class GoogleGtxProvider {
  name = "googlegtx";

  async translateText({ sourceText, forceDirection }) {
    const text = String(sourceText || "").trim();
    if (!text) throw new Error("没有识别到有效文本");
    const direction = detectDirection(text, forceDirection);
    const sl = direction === "zh2en" ? "zh-CN" : "en";
    const tl = direction === "zh2en" ? "en" : "zh-CN";
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", sl);
    url.searchParams.set("tl", tl);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 FaceTalk/0.1" },
    });
    if (!res.ok) {
      throw new Error(`翻译服务失败 (${res.status})`);
    }
    const data = await res.json();
    const translatedText = Array.isArray(data?.[0])
      ? data[0].map((row) => row?.[0] || "").join("").trim()
      : "";
    if (!translatedText) {
      throw new Error("翻译结果为空，请重试");
    }
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
    throw new Error("googlegtx 模式请在浏览器里输入/语音识别，再调用 /api/translate");
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    throw new Error("googlegtx 模式请使用系统语音播报");
  }
}

class YoudaoProvider {
  name = "youdao";

  constructor({ appKey, appSecret }) {
    if (!appKey?.trim() || !appSecret?.trim()) {
      throw new Error("YOUDAO_APP_KEY and YOUDAO_APP_SECRET are required");
    }
    this.appKey = appKey.trim();
    this.appSecret = appSecret.trim();
  }

  async translateText({ sourceText, forceDirection }) {
    const text = String(sourceText || "").trim();
    if (!text) throw new Error("没有识别到有效文本");
    const direction = detectDirection(text, forceDirection);
    const from = direction === "zh2en" ? "zh-CHS" : "en";
    const to = direction === "zh2en" ? "en" : "zh-CHS";
    const data = await this.postForm("https://openapi.youdao.com/api", {
      q: text,
      from,
      to,
      strict: "true",
    });
    if (String(data.errorCode) !== "0") {
      throw new Error(youdaoErrorMessage("MT", data.errorCode));
    }
    const translatedText = String(data.translation?.[0] || "").trim();
    if (!translatedText) throw new Error("翻译结果为空，请重试");
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

  async transcribeAndTranslate({ audioBuffer, mimeType, forceDirection }) {
    const t0 = Date.now();
    const sourceText = await this.transcribe(audioBuffer, mimeType, forceDirection);
    const asrMs = Date.now() - t0;
    if (!sourceText.trim()) {
      throw new Error("没有识别到有效语音，请重试");
    }
    const t1 = Date.now();
    const result = await this.translateText({ sourceText, forceDirection });
    result.timings = { asrMs, mtMs: Date.now() - t1, totalMs: Date.now() - t0 };
    return result;
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    throw new Error("youdao 模式请使用系统语音播报");
  }

  async transcribe(audioBuffer, mimeType, forceDirection) {
    const wav = await convertToWav16kMono(audioBuffer, mimeType);
    const q = wav.toString("base64");
    if (forceDirection === "zh2en") {
      return this.recognizeOnce(q, "zh-CHS");
    }
    if (forceDirection === "en2zh") {
      return this.recognizeOnce(q, "en");
    }
    // Auto: run zh/en ASR in parallel, pick the script-matching transcript.
    const [zhRes, enRes] = await Promise.allSettled([
      this.recognizeOnce(q, "zh-CHS"),
      this.recognizeOnce(q, "en"),
    ]);
    const zh = zhRes.status === "fulfilled" ? zhRes.value : "";
    const en = enRes.status === "fulfilled" ? enRes.value : "";
    const picked = pickAsrTranscript(zh, en);
    if (picked) return picked;
    if (zhRes.status === "rejected" && enRes.status === "rejected") {
      throw zhRes.reason instanceof Error
        ? zhRes.reason
        : new Error("有道语音识别失败");
    }
    throw new Error("没有识别到有效语音，请重试");
  }

  async recognizeOnce(qBase64, langType) {
    const data = await this.postForm("https://openapi.youdao.com/asrapi", {
      q: qBase64,
      langType,
      format: "wav",
      rate: "16000",
      channel: "1",
      type: "1",
    });
    if (String(data.errorCode) !== "0") {
      throw new Error(youdaoErrorMessage("ASR", data.errorCode));
    }
    const result = data.result;
    if (Array.isArray(result)) return result.join("").trim();
    return String(result || "").trim();
  }

  async postForm(url, extra) {
    const salt = randomUUID();
    const curtime = String(Math.floor(Date.now() / 1000));
    const q = String(extra.q ?? "");
    const sign = sha256Hex(
      this.appKey + truncateForSign(q) + salt + curtime + this.appSecret,
    );
    const body = new URLSearchParams({
      ...extra,
      appKey: this.appKey,
      salt,
      curtime,
      sign,
      signType: "v3",
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`有道接口失败 (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res.json();
  }
}

function truncateForSign(q) {
  const s = String(q);
  if (s.length <= 20) return s;
  return `${s.slice(0, 10)}${s.length}${s.slice(-10)}`;
}

/** Prefer the transcript whose script matches the ASR language hypothesis. */
export function pickAsrTranscript(zhText, enText) {
  const zh = String(zhText || "").trim();
  const en = String(enText || "").trim();
  if (!zh && !en) return "";
  if (zh && !en) return zh;
  if (en && !zh) return en;

  const zhCjk = (zh.match(/[\u4e00-\u9fff]/g) || []).length;
  const enCjk = (en.match(/[\u4e00-\u9fff]/g) || []).length;
  const zhLatin = (zh.match(/[A-Za-z]/g) || []).length;
  const enLatin = (en.match(/[A-Za-z]/g) || []).length;

  // Mandarin ASR returned real Chinese → trust it over romanization.
  if (zhCjk >= 2 && zhCjk >= zhLatin) return zh;
  // English ASR returned Latin-heavy text while Mandarin ASR did not.
  if (enLatin >= 3 && enCjk === 0 && zhCjk < 2) return en;

  const zhScore = zhCjk * 4 - zhLatin + Math.min(zh.length, 24) * 0.05;
  const enScore = enLatin * 4 - enCjk * 2 + Math.min(en.length, 24) * 0.05;
  return zhScore >= enScore ? zh : en;
}

function youdaoErrorMessage(kind, code) {
  const c = String(code);
  if (c === "110") {
    return kind === "ASR"
      ? "有道应用未绑定「短语音识别」服务：请在 ai.youdao.com 控制台创建短语音识别实例并绑定到当前应用"
      : "有道应用未绑定「文本翻译」服务：请在控制台创建实例并绑定应用";
  }
  if (c === "401") return "有道账户欠费或停用，请到控制台检查余额";
  if (c === "411" || c === "412") return "有道接口访问过频，请稍后再试";
  return `有道${kind === "ASR" ? "语音识别" : "翻译"}失败 (errorCode=${c})`;
}

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

class MyMemoryProvider {
  name = "mymemory";

  async translateText({ sourceText, forceDirection }) {
    const text = String(sourceText || "").trim();
    if (!text) throw new Error("没有识别到有效文本");
    const direction = detectDirection(text, forceDirection);
    const langpair = direction === "zh2en" ? "zh-CN|en" : "en|zh-CN";
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", langpair);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`翻译服务失败 (${res.status})`);
    }
    const data = await res.json();
    const translatedText = String(data?.responseData?.translatedText || "").trim();
    if (!translatedText) {
      throw new Error("翻译结果为空，请重试");
    }
    // MyMemory returns THE EQUIVALENT OF when quota exceeded
    if (/^\*?MYMEMORY WARNING/i.test(translatedText)) {
      throw new Error("免密翻译额度用尽，请稍后再试或改用 OpenAI");
    }
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
    throw new Error("mymemory 模式请在浏览器里语音识别，再调用 /api/translate");
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    throw new Error("mymemory 模式请使用系统语音播报");
  }
}

class OpenAIProvider {
  name = "openai";

  constructor({ apiKey, baseUrl }) {
    if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY is required for openai provider");
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async translateText({ sourceText, forceDirection }) {
    return this.translateViaChat(sourceText, forceDirection);
  }

  async transcribeAndTranslate({ audioBuffer, mimeType, fileName, forceDirection }) {
    const sourceText = await this.transcribe(audioBuffer, mimeType, fileName);
    if (!sourceText.trim()) {
      throw new Error("没有识别到有效语音，请重试");
    }
    return this.translateViaChat(sourceText, forceDirection);
  }

  async retranslate({ sourceText, direction }) {
    return this.translateViaChat(sourceText, direction);
  }

  async transcribe(audioBuffer, mimeType, fileName) {
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
    form.append("file", blob, fileName || "speech.webm");
    form.append("model", "gpt-4o-mini-transcribe");

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        return this.transcribeWhisper(audioBuffer, mimeType, fileName);
      }
      const detail = await res.text();
      throw new Error(`ASR failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    return String(data.text || "").trim();
  }

  async transcribeWhisper(audioBuffer, mimeType, fileName) {
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
    form.append("file", blob, fileName || "speech.webm");
    form.append("model", "whisper-1");
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`ASR failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    return String(data.text || "").trim();
  }

  async translateViaChat(sourceText, forceDirection) {
    const system = `You are a bilingual conversation translator for Mandarin Chinese and English.
Return ONLY compact JSON with keys: sourceLang ("zh"|"en"), targetLang ("zh"|"en"), direction ("zh2en"|"en2zh"), sourceText, translatedText.
Rules:
- If forceDirection is zh2en or en2zh, obey it even if detection disagrees.
- Otherwise detect the dominant language of the utterance and translate to the other language.
- Keep meaning; be concise and natural for spoken conversation.
- sourceText should be a cleaned transcript of the input (same language as sourceLang).`;

    const user = JSON.stringify({
      utterance: sourceText,
      forceDirection: forceDirection || null,
    });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`MT failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const direction =
      forceDirection ||
      (parsed.direction === "en2zh" ? "en2zh" : "zh2en");
    return {
      sourceLang: direction === "zh2en" ? "zh" : "en",
      targetLang: direction === "zh2en" ? "en" : "zh",
      direction,
      sourceText: String(parsed.sourceText || sourceText).trim(),
      translatedText: String(parsed.translatedText || "").trim(),
      detected: !forceDirection,
      provider: this.name,
    };
  }

  async synthesize({ text, lang }) {
    const voice = lang === "zh" ? "nova" : "alloy";
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const fallback = await fetch(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice,
          input: text,
          response_format: "mp3",
        }),
      });
      if (!fallback.ok) {
        const detail = await fallback.text();
        throw new Error(`TTS failed (${fallback.status}): ${detail.slice(0, 300)}`);
      }
      const buf = Buffer.from(await fallback.arrayBuffer());
      return { buffer: buf, contentType: "audio/mpeg" };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: "audio/mpeg" };
  }
}

function buildSilentWav(seconds) {
  const sampleRate = 16000;
  const numSamples = Math.max(1, Math.floor(sampleRate * seconds));
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
