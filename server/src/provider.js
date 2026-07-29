/**
 * Translation providers:
 * - googlegtx: free unofficial Google translate endpoint (best free quality)
 * - mymemory: free text MT fallback (quality uneven on Chinese)
 * - mock: offline stub
 * - openai: cloud ASR + MT + TTS when OPENAI_API_KEY is set
 */

export function createProvider({ name, apiKey, baseUrl }) {
  if (name === "mock") return new MockProvider();
  if (name === "googlegtx") return new GoogleGtxProvider();
  if (name === "mymemory") return new MyMemoryProvider();
  if (name === "openai") return new OpenAIProvider({ apiKey, baseUrl });
  throw new Error(`Unknown provider: ${name}`);
}

export function detectDirection(text, forceDirection) {
  if (forceDirection === "zh2en" || forceDirection === "en2zh") return forceDirection;
  const sample = String(text || "");
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk > 0) return "zh2en";
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return latin > 0 ? "en2zh" : "zh2en";
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
