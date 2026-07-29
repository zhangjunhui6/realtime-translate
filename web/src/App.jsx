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
  const [status, setStatus] = useState("自动识别中/英，互译给对方");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);

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
      .catch(() => setHealth({ ok: false, provider: "googlegtx", browserSpeech: true }));
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

  const playTts = useCallback(async (text, lang) => {
    try {
      await speakBrowser(text, lang);
    } catch (err) {
      setError(err instanceof Error ? err.message : "播报失败");
    }
  }, []);

  const appendTurn = useCallback(
    async (turn) => {
      setTurns((prev) => [...prev, turn].slice(-MAX_TURNS));
      if (autoSpeak && turn.translatedText) {
        await playTts(turn.translatedText, turn.targetLang);
      }
    },
    [autoSpeak, playTts],
  );

  const translateText = async (sourceText, forceDirection = null) => {
    setBusy(true);
    setError("");
    setStatus("自动互译中…");
    try {
      const res = await fetch(apiUrl("api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, forceDirection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "翻译失败");
      await appendTurn({ id: crypto.randomUUID(), ...data });
      setStatus("继续说下一句（自动中英互译）");
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "网络或服务异常");
      setStatus("自动识别中/英，互译给对方");
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
      setError("当前浏览器不支持语音识别，请打字（iPhone 请打字）");
      return;
    }
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setError("无法启动语音识别");
      return;
    }
    finalTranscriptRef.current = "";
    setInterim("");
    // Auto mode: let the engine try Chinese first; detection still happens on text.
    recognition.lang = "zh-CN";
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
    setStatus("正在听…说完再点一次（自动判中/英）");
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
      setStatus("自动识别中/英，互译给对方");
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
      if (autoSpeak && data.translatedText) {
        await playTts(data.translatedText, data.targetLang);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重译失败");
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = () => {
    if (busy || recording) return;
    setTurns([]);
    setError("");
    setStatus("自动识别中/英，互译给对方");
  };

  const providerLabel = !health
    ? "连接中"
    : health.provider === "googlegtx"
      ? "自动互译"
      : health.provider || "就绪";

  const phase = recording ? "listening" : busy ? "working" : "idle";
  const latest = turns[turns.length - 1] || null;

  return (
    <div className={`shell phase-${phase}`}>
      <div className="atmosphere" aria-hidden="true" />

      <header className="top">
        <div className="pair-switch" aria-label="语言对">
          <span className="lang">中文</span>
          <span className="auto-badge">AUTO</span>
          <span className="lang en">English</span>
        </div>
        <div className="top-right">
          <span className="pill">{providerLabel}</span>
          <button
            type="button"
            className={`pill toggle ${autoSpeak ? "on" : ""}`}
            onClick={() => setAutoSpeak((v) => !v)}
          >
            {autoSpeak ? "自动播报开" : "自动播报关"}
          </button>
        </div>
      </header>

      <p className="lede">
        参考 Google / 有道对话模式：说中文或英文均可，自动译成另一边。同侧阅读，左中文右英文。
      </p>

      <main className="transcript" ref={listRef}>
        {!turns.length ? (
          <div className="empty">
            <h1>开始自动对话</h1>
            <p>像 Google 翻译对话一样：一人一句，系统自动判语种并互译。</p>
            <ul>
              <li>输入或说话（iPhone 请打字）</li>
              <li>自动中 ↔ 英</li>
              <li>译文可自动朗读</li>
            </ul>
          </div>
        ) : (
          turns.map((turn, index) => {
            const { zh, en, spoken } = bilingualPair(turn);
            const isLatest = index === turns.length - 1;
            return (
              <article key={turn.id} className={`card ${isLatest ? "latest" : ""}`}>
                <div className="card-meta">
                  <span>#{index + 1}</span>
                  <span>{spoken === "zh" ? "中文原文 → 英文" : "English → 中文"}</span>
                </div>
                <div className="duo">
                  <div className={`bubble zh ${spoken === "zh" ? "source" : ""}`}>
                    <span className="label">中文</span>
                    <p>{zh || "—"}</p>
                    {zh ? (
                      <button type="button" disabled={busy} onClick={() => playTts(zh, "zh")}>
                        播报
                      </button>
                    ) : null}
                  </div>
                  <div className={`bubble en ${spoken === "en" ? "source" : ""}`}>
                    <span className="label">English</span>
                    <p>{en || "—"}</p>
                    {en ? (
                      <button type="button" disabled={busy} onClick={() => playTts(en, "en")}>
                        Speak
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </main>

      {latest ? (
        <div className="tools">
          <button type="button" disabled={busy} onClick={() => correctDirection(latest)}>
            翻反了？纠正方向
          </button>
          <button type="button" className="ghost" disabled={busy || recording} onClick={clearHistory}>
            清空对话
          </button>
        </div>
      ) : null}

      <footer className="dock">
        <p className="hint">
          {isIOS || !speechSupported
            ? "iPhone：直接打字发送，自动中英互译"
            : "Android Chrome：可打字或点麦克风，自动互译"}
        </p>
        <div className="compose">
          <input
            ref={inputRef}
            value={draft}
            disabled={busy || recording}
            placeholder="中文或英文都可以…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitDraft();
              }
            }}
          />
          <button type="button" className="send" disabled={busy || recording || !draft.trim()} onClick={() => void submitDraft()}>
            发送
          </button>
          {speechSupported ? (
            <button
              type="button"
              className={`mic ${recording ? "hot" : ""}`}
              disabled={busy && !recording}
              onClick={toggleRecord}
            >
              {recording ? "结束" : "说话"}
            </button>
          ) : null}
        </div>
        <p className="status">{status}</p>
        {interim ? <p className="interim">{interim}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </footer>
    </div>
  );
}
