import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export function detectDirection(text, forceDirection) {
  if (forceDirection === "zh2en" || forceDirection === "en2zh") return forceDirection;
  const sample = String(text || "");
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk > 0) return "zh2en";
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return latin > 0 ? "en2zh" : "zh2en";
}

export async function convertToWav16kMono(audioBuffer, mimeType) {
  const buf = Buffer.isBuffer(audioBuffer)
    ? audioBuffer
    : Buffer.from(audioBuffer);
  if (!buf.length) throw new Error("空音频");

  if (isWav16kMonoPcm(buf)) return buf;

  const ext = guessAudioExt(mimeType);
  const dir = await mkdtemp(join(tmpdir(), "asr-wav-"));
  const inputPath = join(dir, `in.${ext}`);
  const outputPath = join(dir, "out.wav");
  try {
    await writeFile(inputPath, buf);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function wavToPcm16(wavBuf) {
  const buf = Buffer.isBuffer(wavBuf) ? wavBuf : Buffer.from(wavBuf);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("无效 wav");
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "data") {
      return buf.subarray(dataStart, Math.min(dataStart + size, buf.length));
    }
    offset = dataStart + size + (size % 2);
  }
  throw new Error("wav 缺少 data 块");
}

function isWav16kMonoPcm(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return false;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return false;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "fmt " && size >= 16 && dataStart + 16 <= buf.length) {
      const audioFormat = buf.readUInt16LE(dataStart);
      const channels = buf.readUInt16LE(dataStart + 2);
      const sampleRate = buf.readUInt32LE(dataStart + 4);
      return audioFormat === 1 && channels === 1 && sampleRate === 16000;
    }
    offset = dataStart + size + (size % 2);
  }
  return false;
}

function guessAudioExt(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    return "m4a";
  }
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", (err) => {
      reject(
        new Error(
          `无法启动 ffmpeg（云端 ASR 需要把录音转成 16k wav）: ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 转换失败 (exit ${code})`));
    });
  });
}
