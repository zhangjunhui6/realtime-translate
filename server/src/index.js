import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryController } from "./registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const port = Number(process.env.RT_PORT || process.env.PORT || 8787);
const host = process.env.RT_HOST || "0.0.0.0";
const registry = createRegistryController(process.env);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const meta = registry.currentMeta();
  res.json({
    ok: true,
    ...meta,
    providers: registry.list(),
    mock: meta.provider === "mock",
  });
});

app.get("/api/providers", (_req, res) => {
  res.json({ providers: registry.list(), current: registry.currentId() });
});

app.post("/api/provider", (req, res) => {
  try {
    const id = String(req.body?.provider || req.body?.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "missing_provider", message: "缺少方案 id" });
      return;
    }
    const active = registry.setCurrent(id);
    res.json({ ok: true, ...registry.currentMeta(), active, providers: registry.list() });
  } catch (err) {
    res.status(400).json({
      error: "provider_switch_failed",
      message: err instanceof Error ? err.message : "切换失败",
    });
  }
});

/** Text-only turn — used when browser Web Speech does ASR. */
app.post("/api/translate", async (req, res) => {
  try {
    const provider = registry.getProvider();
    const sourceText = String(req.body?.sourceText || "").trim();
    const forceDirection = normalizeDirection(req.body?.forceDirection);
    if (!sourceText) {
      res.status(400).json({ error: "missing_text", message: "缺少识别文本" });
      return;
    }
    if (typeof provider.translateText !== "function") {
      res.status(400).json({ error: "unsupported", message: "当前方案不支持文本翻译" });
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
    const provider = registry.getProvider();
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
    const provider = registry.getProvider();
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
    const meta = registry.currentMeta();
    if (meta.browserSpeech || meta.provider === "youdao" || meta.provider === "local") {
      res.status(400).json({
        error: "use_browser_tts",
        message: "当前模式请使用系统语音播报",
      });
      return;
    }
    const provider = registry.getProvider();
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
app.use(
  express.static(webDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(port, host, () => {
  const meta = registry.currentMeta();
  console.log(
    `realtime-translate server on http://${host}:${port} (provider=${meta.provider})`,
  );
});

function normalizeDirection(value) {
  if (value === "zh2en" || value === "en2zh") return value;
  return null;
}
