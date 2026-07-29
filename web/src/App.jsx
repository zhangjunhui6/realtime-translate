import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_TURNS = 40;

function apiUrl(path) {
  const clean = String(path).replace(/^\//, "");
  const base = `${window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "")}/`;
  return `${base}${clean}`;
}

function getSpeechRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function speakBrowser(text, lang) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error("当前浏览器不支持系统播报"));
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === "en" ? "en-US" : "zh-CN";
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) =>
      lang === "en"
        ? /^en(-|_)/i.test(v.lang)
        : /zh(-|_|$)|chinese|云|晓/i.test(`${v.lang} ${v.name}`),
    );
    if (preferred) utter.voice = preferred;
    utter.onend = () => resolve();
    utter.onerror = () => reject(new Error("播报失败"));
    window.speechSynthesis.speak(utter);
  });
}

function bilingualPair(turn) {
  if (turn.direction === "zh2en") {
    return { zh: turn.sourceText, en: turn.translatedText, spoken: "zh" };
  }
  return { zh: turn.translatedText, en: turn.sourceText, spoken: "en" };
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [turns, setTurns] = useState([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("输入一句话，自动中英互译");
  const [langHint, setLangHint] = useState("zh-CN");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");

  const recognitionRef = useRef(null);
  const listRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const inputRef = useRef(null);

  const speechSupported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );
  const isIOS = useMemo(
    () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    [],
  );

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname && !pathname.endsWith("/") && !pathname.split("/").pop().includes(".")) {
      window.history.replaceState(null, "", `${pathname}/${search}${hash}`);
    }
  }, []);

  useEffect(() => {
    fetch(apiUrl("api/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setHealth({
          ok: false,
          provider: "mymemory",
          browserSpeech: true,
          browserTts: true,
        }),
      );
    window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy, recording, interim]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort?.();
      window.speechSynthesis?.cancel?.();
    },
    [],
  );

  const appendTurn = useCallback((turn) => {
    setTurns((prev) => [...prev, turn].slice(-MAX_TURNS));
    setLangHint(turn.direction === "zh2en" ? "en-US" : "zh-CN");
  }, []);

  const translateText = async (sourceText, forceDirection = null) => {
    setBusy(true);
    setError("");
    setStatus("正在翻译…");
    try {
      const res = await fetch(apiUrl("api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, forceDirection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "翻译失败");
      appendTurn({ id: crypto.randomUUID(), ...data });
      setStatus("继续输入下一句");
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "网络或服务异常");
      setStatus("输入一句话，自动中英互译");
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text || busy || recording) return;
    setDraft("");
    await translateText(text);
  };

  const startBrowserListen = () => {
    setError("");
    if (!speechSupported) {
      setError("当前浏览器不支持语音识别，请打字");
      return;
    }
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setError("无法启动语音识别");
      return;
    }
    finalTranscriptRef.current = "";
    setInterim("");
    recognition.lang = langHint;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = finalTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += piece;
        else interimText += piece;
      }
      finalTranscriptRef.current = finalText;
      setInterim(`${finalText}${interimText}`.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(`语音识别：${event.error}`);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    setStatus("正在听…说完再点一次");
  };

  const stopBrowserListen = async () => {
    const recognition = recognitionRef.current;
    setRecording(false);
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    const text = (finalTranscriptRef.current || interim).trim();
    setInterim("");
    finalTranscriptRef.current = "";
    if (!text) {
      setError("没有听清，请再说一次或改用打字");
      setStatus("输入一句话，自动中英互译");
      return;
    }
    await translateText(text);
  };

  const toggleRecord = () => {
    if (recording) {
      void stopBrowserListen();
      return;
    }
    if (busy) return;
    startBrowserListen();
  };

  const correctDirection = async (turn) => {
    const direction = turn.direction === "zh2en" ? "en2zh" : "zh2en";
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl("api/retranslate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: turn.sourceText, direction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "重译失败");
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, ...data, id: t.id } : t)),
      );
      setLangHint(direction === "zh2en" ? "en-US" : "zh-CN");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重译失败");
    } finally {
      setBusy(false);
    }
  };

  const playTts = async (text, lang) => {
    setError("");
    try {
      await speakBrowser(text, lang);
    } catch (err) {
      setError(err instanceof Error ? err.message : "播报失败");
    }
  };

  const clearHistory = () => {
    if (busy || recording) return;
    setTurns([]);
    setError("");
    setLangHint("zh-CN");
    setStatus("输入一句话，自动中英互译");
  };

  const providerLabel =
    !health ? "连接中" : health.provider === "mymemory" ? "免密钥" : health.provider || "就绪";

  const phase = recording ? "listening" : busy ? "working" : "idle";
  const latest = turns[turns.length - 1] || null;

  return (
    <div className={`shell phase-${phase}`}>
      <div className="atmosphere" aria-hidden="true" />

      <header className="brand-bar">
        <div className="brand-mark">
          <span className="brand-name">对面</span>
          <span className="brand-en">FaceTalk</span>
        </div>
        <div className="brand-meta">
          <span className="pill">{providerLabel}</span>
          <span className="pill soft">{turns.length} 轮</span>
        </div>
      </header>

      <p className="tagline">面对面说话，同侧阅读 · 左中文，右英文</p>

      <div className="lane-heads" aria-hidden="true">
        <div className="lane-head zh">中文</div>
        <div className="lane-head en">English</div>
      </div>

      <main className="stream" ref={listRef}>
        {!turns.length ? (
          <div className="empty-state">
            <p className="empty-title">开始第一句</p>
            <p className="empty-copy">
              两个人看着同一块屏幕。你说中文，对面看右边英文；对方说英文，你看左边中文。
            </p>
            <ol className="empty-steps">
              <li>底部输入中文或英文</li>
              <li>自动识别方向并翻译</li>
              <li>点播报朗读给对方听</li>
            </ol>
          </div>
        ) : (
          turns.map((turn, index) => {
            const { zh, en, spoken } = bilingualPair(turn);
            const isLatest = index === turns.length - 1;
            return (
              <section
                key={turn.id}
                className={`exchange ${isLatest ? "is-latest" : ""}`}
                data-spoken={spoken}
              >
                <div className="exchange-index">#{index + 1}</div>
                <div className="pair">
                  <article className={`panel zh ${spoken === "zh" ? "is-source" : "is-target"}`}>
                    <header>
                      <span>中文</span>
                      <span className="role">{spoken === "zh" ? "原文" : "译文"}</span>
                    </header>
                    <p>{zh || "—"}</p>
                    {zh ? (
                      <button type="button" className="ghost-btn" disabled={busy} onClick={() => playTts(zh, "zh")}>
                        播报
                      </button>
                    ) : null}
                  </article>
                  <article className={`panel en ${spoken === "en" ? "is-source" : "is-target"}`}>
                    <header>
                      <span>English</span>
                      <span className="role">{spoken === "en" ? "Source" : "Translation"}</span>
                    </header>
                    <p>{en || "—"}</p>
                    {en ? (
                      <button type="button" className="ghost-btn" disabled={busy} onClick={() => playTts(en, "en")}>
                        Speak
                      </button>
                    ) : null}
                  </article>
                </div>
              </section>
            );
          })
        )}
      </main>

      {latest ? (
        <div className="utility-row">
          <button type="button" className="text-btn" disabled={busy} onClick={() => correctDirection(latest)}>
            纠正方向 · {latest.direction === "zh2en" ? "中→英" : "英→中"}
          </button>
          {latest.detected ? <span className="hint-ok">已自动检测</span> : null}
          <button type="button" className="text-btn muted" disabled={busy || recording} onClick={clearHistory}>
            清空
          </button>
        </div>
      ) : null}

      <footer className="dock">
        {isIOS || !speechSupported ? (
          <p className="dock-tip">iPhone 请直接打字；点播报可用系统朗读</p>
        ) : (
          <p className="dock-tip">可打字，或点右侧麦克风说话</p>
        )}

        <div className="dock-row">
          <button
            type="button"
            className="pref"
            disabled={recording || busy}
            onClick={() => setLangHint((h) => (h === "zh-CN" ? "en-US" : "zh-CN"))}
            title="语音识别偏好"
          >
            {langHint === "zh-CN" ? "中" : "EN"}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder={langHint === "zh-CN" ? "说点什么…" : "Say something…"}
            disabled={busy || recording}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitDraft();
              }
            }}
          />

          <button
            type="button"
            className="send"
            disabled={busy || recording || !draft.trim()}
            onClick={() => void submitDraft()}
          >
            发送
          </button>

          {speechSupported ? (
            <button
              type="button"
              className={`mic ${recording ? "hot" : ""}`}
              onClick={toggleRecord}
              disabled={busy && !recording}
              aria-label={recording ? "结束录音" : "开始说话"}
            >
              {recording ? "停" : "麦"}
            </button>
          ) : null}
        </div>

        <p className="dock-status">{status}</p>
        {interim ? <p className="dock-interim">{interim}</p> : null}
        {error ? <p className="dock-error">{error}</p> : null}
      </footer>
    </div>
  );
}
