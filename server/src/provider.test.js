import test from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "./provider.js";

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
