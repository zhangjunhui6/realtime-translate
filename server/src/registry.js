/**
 * Runtime provider registry — supports switching without process restart.
 */

import { createProvider } from "./provider.js";

const LABELS = {
  local: "本地最快",
  googlegtx: "本地最快",
  youdao: "有道智云",
  xunfei: "讯飞",
  volcano: "火山引擎",
  mymemory: "MyMemory",
  openai: "OpenAI",
  mock: "Mock",
};

export function buildRegistry(env = process.env) {
  const entries = [];

  // Local free path: browser ASR + Google gtx MT
  entries.push({
    id: "local",
    label: LABELS.local,
    ready: true,
    cloudAsr: false,
    browserSpeech: true,
    hint: "浏览器语音 + 免密翻译，通常最快",
    factory: () => createProvider({ name: "googlegtx" }),
  });

  const hasYoudao = Boolean(
    env.YOUDAO_APP_KEY?.trim() && env.YOUDAO_APP_SECRET?.trim(),
  );
  entries.push({
    id: "youdao",
    label: LABELS.youdao,
    ready: hasYoudao,
    cloudAsr: true,
    browserSpeech: false,
    hint: hasYoudao
      ? "有道文本翻译 + 短语音识别"
      : "需要 YOUDAO_APP_KEY / YOUDAO_APP_SECRET",
    factory: () =>
      createProvider({
        name: "youdao",
        youdaoAppKey: env.YOUDAO_APP_KEY,
        youdaoAppSecret: env.YOUDAO_APP_SECRET,
      }),
  });

  const hasXunfei = Boolean(
    env.XUNFEI_APP_ID?.trim() &&
      env.XUNFEI_API_KEY?.trim() &&
      env.XUNFEI_API_SECRET?.trim(),
  );
  entries.push({
    id: "xunfei",
    label: LABELS.xunfei,
    ready: hasXunfei,
    cloudAsr: true,
    browserSpeech: false,
    hint: hasXunfei
      ? "讯飞机器翻译 + 语音听写"
      : "待接入：需要 XUNFEI_APP_ID / API_KEY / API_SECRET",
    factory: hasXunfei
      ? () =>
          createProvider({
            name: "xunfei",
            xunfeiAppId: env.XUNFEI_APP_ID,
            xunfeiApiKey: env.XUNFEI_API_KEY,
            xunfeiApiSecret: env.XUNFEI_API_SECRET,
          })
      : null,
  });

  const hasVolcano = Boolean(
    env.VOLC_ARK_API_KEY?.trim() && env.VOLC_ARK_MODEL?.trim(),
  );
  entries.push({
    id: "volcano",
    label: LABELS.volcano,
    ready: hasVolcano,
    cloudAsr: false,
    browserSpeech: true,
    hint: hasVolcano
      ? "火山方舟文本翻译（语音请用浏览器或切有道/讯飞）"
      : env.VOLC_ARK_API_KEY?.trim()
        ? "已有方舟 Key，还缺 VOLC_ARK_MODEL（接入点 ep-...）"
        : "待接入：需要 VOLC_ARK_API_KEY + VOLC_ARK_MODEL",
    factory: hasVolcano
      ? () =>
          createProvider({
            name: "volcano",
            volcanoArkApiKey: env.VOLC_ARK_API_KEY,
            volcanoArkModel: env.VOLC_ARK_MODEL,
            volcanoArkBaseUrl: env.VOLC_ARK_BASE_URL,
          })
      : null,
  });

  return entries;
}

export function createRegistryController(env = process.env) {
  const catalog = buildRegistry(env);
  const instances = new Map();

  function resolveInitial() {
    const configured = (env.TRANSLATE_PROVIDER || "").toLowerCase();
    const alias = configured === "googlegtx" ? "local" : configured;
    const preferred = [alias, "youdao", "local"].filter(Boolean);
    for (const id of preferred) {
      const entry = catalog.find((e) => e.id === id && e.ready && e.factory);
      if (entry) return entry.id;
    }
    return "local";
  }

  let currentId = resolveInitial();

  function getEntry(id) {
    return catalog.find((e) => e.id === id) || null;
  }

  function getProvider(id = currentId) {
    const entry = getEntry(id);
    if (!entry?.ready || !entry.factory) {
      throw new Error(entry?.hint || `方案不可用: ${id}`);
    }
    if (!instances.has(id)) {
      const provider = entry.factory();
      // Normalize public name for health/UI
      if (id === "local") provider.name = "local";
      instances.set(id, provider);
    }
    return instances.get(id);
  }

  function list() {
    return catalog.map((e) => ({
      id: e.id,
      label: e.label,
      ready: e.ready,
      cloudAsr: e.cloudAsr,
      browserSpeech: e.browserSpeech,
      hint: e.hint,
      active: e.id === currentId,
    }));
  }

  function setCurrent(id) {
    const entry = getEntry(id);
    if (!entry) throw new Error(`未知方案: ${id}`);
    if (!entry.ready || !entry.factory) {
      throw new Error(entry.hint || `方案未就绪: ${id}`);
    }
    // Ensure constructible
    getProvider(id);
    currentId = id;
    return list().find((e) => e.id === id);
  }

  function currentMeta() {
    const entry = getEntry(currentId);
    return {
      provider: currentId,
      label: entry?.label || currentId,
      browserSpeech: Boolean(entry?.browserSpeech),
      cloudAsr: Boolean(entry?.cloudAsr),
      browserTts: true,
    };
  }

  return {
    list,
    setCurrent,
    getProvider: () => getProvider(currentId),
    currentMeta,
    currentId: () => currentId,
  };
}
