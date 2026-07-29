import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, detectDirection, pickAsrTranscript } from "./provider.js";

test("detectDirection prefers CJK as zh2en", () => {
  assert.equal(detectDirection("你好世界 hello"), "zh2en");
  assert.equal(detectDirection("Where is the station?"), "en2zh");
  assert.equal(detectDirection("hi", "zh2en"), "zh2en");
});

test("pickAsrTranscript prefers matching script", () => {
  assert.equal(pickAsrTranscript("你好吗", "Ni hao ma"), "你好吗");
  assert.equal(pickAsrTranscript("你好世界", "hello world"), "你好世界");
  assert.equal(
    pickAsrTranscript("Ni hao", "Where is the restroom"),
    "Where is the restroom",
  );
  assert.equal(pickAsrTranscript("", "hello"), "hello");
  assert.equal(pickAsrTranscript("你好", ""), "你好");
});

test("mock translateText respects forceDirection", async () => {
  const provider = createProvider({ name: "mock" });
  const result = await provider.translateText({
    sourceText: "你好",
    forceDirection: "zh2en",
  });
  assert.equal(result.direction, "zh2en");
  assert.match(result.translatedText, /EN/);
});

test("googlegtx provider is constructible", () => {
  const provider = createProvider({ name: "googlegtx" });
  assert.equal(provider.name, "googlegtx");
});

test("youdao provider requires app credentials", () => {
  assert.throws(
    () => createProvider({ name: "youdao" }),
    /YOUDAO_APP_KEY/,
  );
});

test("youdao provider is constructible with credentials", () => {
  const provider = createProvider({
    name: "youdao",
    youdaoAppKey: "demo-key",
    youdaoAppSecret: "demo-secret",
  });
  assert.equal(provider.name, "youdao");
});

test("mock provider returns zh/en turn payload", async () => {
  const provider = createProvider({ name: "mock" });
  const result = await provider.transcribeAndTranslate({
    audioBuffer: Buffer.from("x"),
    forceDirection: "zh2en",
  });
  assert.equal(result.direction, "zh2en");
  assert.equal(result.sourceLang, "zh");
  assert.equal(result.targetLang, "en");
  assert.ok(result.sourceText);
  assert.ok(result.translatedText);
});

test("mock retranslate flips label by direction", async () => {
  const provider = createProvider({ name: "mock" });
  const result = await provider.retranslate({
    sourceText: "hello",
    direction: "en2zh",
  });
  assert.equal(result.direction, "en2zh");
  assert.match(result.translatedText, /中文/);
});
