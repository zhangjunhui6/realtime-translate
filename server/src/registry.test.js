import test from "node:test";
import assert from "node:assert/strict";
import { createRegistryController } from "./registry.js";

test("registry defaults to local when no cloud keys", () => {
  const reg = createRegistryController({ TRANSLATE_PROVIDER: "" });
  assert.equal(reg.currentId(), "local");
  assert.equal(reg.currentMeta().browserSpeech, true);
});

test("registry can switch between local and youdao when keys present", () => {
  const reg = createRegistryController({
    TRANSLATE_PROVIDER: "youdao",
    YOUDAO_APP_KEY: "k",
    YOUDAO_APP_SECRET: "s",
  });
  assert.equal(reg.currentId(), "youdao");
  reg.setCurrent("local");
  assert.equal(reg.currentId(), "local");
  assert.equal(reg.getProvider().name, "local");
  reg.setCurrent("youdao");
  assert.equal(reg.currentId(), "youdao");
});

test("xunfei is ready when keys present", () => {
  const reg = createRegistryController({
    XUNFEI_APP_ID: "id",
    XUNFEI_API_KEY: "key",
    XUNFEI_API_SECRET: "secret",
  });
  const xf = reg.list().find((p) => p.id === "xunfei");
  assert.equal(xf.ready, true);
  reg.setCurrent("xunfei");
  assert.equal(reg.currentId(), "xunfei");
});

test("volcano ready only with ark key and model", () => {
  const incomplete = createRegistryController({
    VOLC_ARK_API_KEY: "k",
  });
  assert.equal(incomplete.list().find((p) => p.id === "volcano").ready, false);
  const reg = createRegistryController({
    VOLC_ARK_API_KEY: "k",
    VOLC_ARK_MODEL: "ep-test",
  });
  assert.equal(reg.list().find((p) => p.id === "volcano").ready, true);
});
