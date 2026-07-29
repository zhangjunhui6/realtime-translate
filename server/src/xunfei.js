/**
 * iFlytek (讯飞) — machine translation (HTTP) + speech dictation (WebSocket IAT).
 */

import { createHash, createHmac } from "node:crypto";
import { convertToWav16kMono, detectDirection, wavToPcm16 } from "./audio-util.js";

export class XunfeiProvider {
  name = "xunfei";

  constructor({ appId, apiKey, apiSecret }) {
    if (!appId?.trim() || !apiKey?.trim() || !apiSecret?.trim()) {
      throw new Error("XUNFEI_APP_ID / API_KEY / API_SECRET are required");
    }
    this.appId = appId.trim();
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
  }

  async translateText({ sourceText, forceDirection }) {
    const text = String(sourceText || "").trim();
    if (!text) throw new Error("没有识别到有效文本");
    const direction = detectDirection(text, forceDirection);
    const from = direction === "zh2en" ? "cn" : "en";
    const to = direction === "zh2en" ? "en" : "cn";

    const bodyObj = {
      common: { app_id: this.appId },
      business: { from, to },
      data: { text: Buffer.from(text, "utf8").toString("base64") },
    };
    const body = JSON.stringify(bodyObj);
    const host = "itrans.xfyun.cn";
    const uri = "/v2/its";
    const date = new Date().toUTCString();
    const digest = `SHA-256=${createHash("sha256").update(body).digest("base64")}`;
    const signatureOrigin = [
      `host: ${host}`,
      `date: ${date}`,
      `POST ${uri} HTTP/1.1`,
      `digest: ${digest}`,
    ].join("\n");
    const signature = createHmac("sha256", this.apiSecret)
      .update(signatureOrigin)
      .digest("base64");
    const authorization = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${signature}"`;

    const res = await fetch(`https://${host}${uri}`, {
      method: "POST",
      headers: {
        Host: host,
        Date: date,
        Digest: digest,
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    const code = data?.code ?? data?.header?.code;
    if (!res.ok || (code !== undefined && Number(code) !== 0)) {
      throw new Error(
        `讯飞翻译失败 (code=${code ?? res.status}): ${data?.message || data?.header?.message || ""}`.trim(),
      );
    }
    const translatedText = String(
      data?.data?.result?.trans_result?.dst ||
        data?.data?.result?.dst ||
        "",
    ).trim();
    if (!translatedText) throw new Error("讯飞翻译结果为空");
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
    if (!sourceText.trim()) throw new Error("没有识别到有效语音，请重试");
    const t1 = Date.now();
    const result = await this.translateText({ sourceText, forceDirection });
    result.timings = { asrMs, mtMs: Date.now() - t1, totalMs: Date.now() - t0 };
    return result;
  }

  async retranslate({ sourceText, direction }) {
    return this.translateText({ sourceText, forceDirection: direction });
  }

  async synthesize() {
    throw new Error("讯飞模式请使用系统语音播报");
  }

  async transcribe(audioBuffer, mimeType, forceDirection) {
    const wav = await convertToWav16kMono(audioBuffer, mimeType);
    const pcm = wavToPcm16(wav);
    const language =
      forceDirection === "en2zh" ? "en_us" : "zh_cn"; // zh_cn also handles simple English
    return this.recognizePcm(pcm, language);
  }

  async recognizePcm(pcm, language) {
    if (typeof WebSocket === "undefined") {
      throw new Error("当前 Node 不支持 WebSocket，无法调用讯飞听写");
    }
    const url = assembleIatAuthUrl(
      "wss://iat-api.xfyun.cn/v2/iat",
      this.apiKey,
      this.apiSecret,
    );

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      const parts = [];
      const timer = setTimeout(() => {
        fail(new Error("讯飞语音识别超时"));
      }, 45000);

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const succeed = (text) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(text);
      };

      ws.addEventListener("open", async () => {
        try {
          const frameSize = 1280;
          let offset = 0;
          let status = 0; // 0 first, 1 mid, 2 last
          while (offset < pcm.length) {
            const end = Math.min(offset + frameSize, pcm.length);
            const chunk = pcm.subarray(offset, end);
            const isLast = end >= pcm.length;
            if (isLast) status = 2;
            const payload = {
              data: {
                status,
                format: "audio/L16;rate=16000",
                encoding: "raw",
                audio: Buffer.from(chunk).toString("base64"),
              },
            };
            if (status === 0) {
              payload.common = { app_id: this.appId };
              payload.business = {
                language,
                domain: "iat",
                accent: "mandarin",
                vad_eos: 3000,
                dwa: "wpgs",
              };
            }
            ws.send(JSON.stringify(payload));
            status = 1;
            offset = end;
            if (!isLast) await sleep(20);
          }
        } catch (err) {
          fail(err);
        }
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          const code = msg?.code;
          if (code !== undefined && Number(code) !== 0) {
            fail(new Error(`讯飞听写失败 (code=${code}): ${msg?.message || ""}`));
            return;
          }
          const result = msg?.data?.result;
          if (result?.ws) {
            const piece = result.ws
              .map((w) => (w.cw || []).map((c) => c.w || "").join(""))
              .join("");
            // wpgs: rpl replaces previous partials — keep simple append of final-ish pieces
            if (result.pgs === "rpl" && Array.isArray(result.rg)) {
              // naive: reset and use latest piece stream by rebuilding from this result only
              parts.length = 0;
              parts.push(piece);
            } else {
              parts.push(piece);
            }
          }
          if (msg?.data?.status === 2) {
            succeed(parts.join("").trim());
          }
        } catch (err) {
          fail(err);
        }
      });

      ws.addEventListener("error", () => fail(new Error("讯飞听写 WebSocket 错误")));
      ws.addEventListener("close", () => {
        if (!settled) {
          const text = parts.join("").trim();
          if (text) succeed(text);
          else fail(new Error("讯飞听写连接关闭且无结果"));
        }
      });
    });
  }
}

function assembleIatAuthUrl(hostUrl, apiKey, apiSecret) {
  const u = new URL(hostUrl);
  const date = new Date().toUTCString();
  const signatureOrigin = [
    `host: ${u.host}`,
    `date: ${date}`,
    `GET ${u.pathname} HTTP/1.1`,
  ].join("\n");
  const signature = createHmac("sha256", apiSecret)
    .update(signatureOrigin)
    .digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");
  u.searchParams.set("authorization", authorization);
  u.searchParams.set("date", date);
  u.searchParams.set("host", u.host);
  return u.toString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
