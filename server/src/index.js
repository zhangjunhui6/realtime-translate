import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider } from "./provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

// Prefer RT_* so ambient PORT/HOST (e.g. conda/devbox) cannot hijack bind address.
const port = Number(process.env.RT_PORT || 8787);
const host = process.env.RT_HOST || "0.0.0.0";
const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
const configured = (process.env.TRANSLATE_PROVIDER || "").toLowerCase();
const providerName =
  configured ||
  (hasKey ? "openai" : "mymemory");
const provider = createProvider({
  name: providerName === "openai" && !hasKey ? "mymemory" : providerName,
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

const browserSpeech = provider.name === "mymemory" || provider.name === "mock";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: provider.name,
    mock: provider.name === "mock",
    browserSpeech,
    browserTts: browserSpeech,
    needsOpenAIKey: provider.name === "openai",
  });
});

/** Text-only turn — used when browser Web Speech does ASR. */
app.post("/api/translate", async (req, res) => {
  try {
    const sourceText = String(req.body?.sourceText || "").trim();
    const forceDirection = normalizeDirection(req.body?.forceDirection);
    if (!sourceText) {
      res.status(400).json({ error: "missing_text", message: "缺少识别文本" });
      return;
    }
    if (typeof provider.translateText !== "function") {
      res.status(400).json({ error: "unsupported", message: "当前 provider 不支持文本翻译" });
      return;
    }
    const result = await provider.translateText({ sourceText, forceDirection });
    res.json(result);
  } catch (err) {
    console.error("[translate]", err);
    res.status(502).json({
      error: "translate_failed",
      message: err instanceof Error ? err.message : "翻译失败",
    });
  }
});

app.post("/api/turn", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "missing_audio", message: "请先录音再发送" });
      return;
    }
    const forceDirection = normalizeDirection(req.body?.forceDirection);
    const result = await provider.transcribeAndTranslate({
      audioBuffer: req.file.buffer,
      mimeType: req.file.mimetype || "audio/webm",
      fileName: req.file.originalname || "speech.webm",
      forceDirection,
    });
    res.json(result);
  } catch (err) {
    console.error("[turn]", err);
    res.status(502).json({
      error: "turn_failed",
      message: err instanceof Error ? err.message : "翻译失败",
    });
  }
});

app.post("/api/retranslate", async (req, res) => {
  try {
    const sourceText = String(req.body?.sourceText || "").trim();
    const direction = normalizeDirection(req.body?.direction);
    if (!sourceText) {
      res.status(400).json({ error: "missing_text", message: "缺少原文" });
      return;
    }
    if (!direction) {
      res.status(400).json({ error: "missing_direction", message: "请指定 zh2en 或 en2zh" });
      return;
    }
    const result = await provider.retranslate({ sourceText, direction });
    res.json(result);
  } catch (err) {
    console.error("[retranslate]", err);
    res.status(502).json({
      error: "retranslate_failed",
      message: err instanceof Error ? err.message : "重译失败",
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    if (browserSpeech) {
      res.status(400).json({
        error: "use_browser_tts",
        message: "当前模式请使用系统语音播报",
      });
      return;
    }
    const text = String(req.body?.text || "").trim();
    const lang = req.body?.lang === "en" ? "en" : "zh";
    if (!text) {
      res.status(400).json({ error: "missing_text", message: "缺少播报文本" });
      return;
    }
    const audio = await provider.synthesize({ text, lang });
    res.setHeader("Content-Type", audio.contentType);
    res.send(audio.buffer);
  } catch (err) {
    console.error("[tts]", err);
    res.status(502).json({
      error: "tts_failed",
      message: err instanceof Error ? err.message : "播报失败",
    });
  }
});

const webDist = path.join(rootDir, "web/dist");
app.use(express.static(webDist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(port, host, () => {
  console.log(`realtime-translate server on http://${host}:${port} (provider=${provider.name})`);
});

function normalizeDirection(value) {
  if (value === "zh2en" || value === "en2zh") return value;
  return null;
}
