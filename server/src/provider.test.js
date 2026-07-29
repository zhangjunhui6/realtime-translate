import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, detectDirection } from "./provider.js";

test("detectDirection prefers CJK as zh2en", () => {
  assert.equal(detectDirection("你好世界 hello"), "zh2en");
  assert.equal(detectDirection("Where is the station?"), "en2zh");
  assert.equal(detectDirection("hi", "zh2en"), "zh2en");
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
