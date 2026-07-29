import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_TURNS = 40;

/** Prefix API paths for reverse-proxied short links like /s/xxxx/ */
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

/** Split a turn into left(zh) / right(en) texts for same-orientation chat. */
function bilingualPair(turn) {
  if (turn.direction === "zh2en") {
    return { zh: turn.sourceText, en: turn.translatedText };
  }
  return { zh: turn.translatedText, en: turn.sourceText };
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [turns, setTurns] = useState([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("可打字发送；支持语音的浏览器可点「说话」");
  const [langHint, setLangHint] = useState("zh-CN");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");

  const recognitionRef = useRef(null);
  const listRef = useRef(null);
  const finalTranscriptRef = useRef("");

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
    setStatus("翻译中…");
    try {
      const res = await fetch(apiUrl("api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, forceDirection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "翻译失败");
      appendTurn({ id: crypto.randomUUID(), ...data });
      setStatus(speechSupported ? "可继续说话或打字" : "继续打字发送（iOS 建议打字）");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "网络或服务异常");
      setStatus("可打字发送；支持语音的浏览器可点「说话」");
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
      setError("当前浏览器不支持语音识别（iOS 请用下方打字）");
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
    setStatus(`正在聆听（${langHint}）…说完再点一次`);
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
      setError("没有听清，请靠近麦克风再说一次，或改用打字");
      setStatus("可打字发送；支持语音的浏览器可点「说话」");
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
  };

  const providerLabel = !health
    ? "检测中…"
    : health.provider === "mymemory"
      ? "免密钥（MyMemory）"
      : health.provider || "…";

  const phase = recording ? "listening" : busy ? "working" : "idle";
  const latest = turns[turns.length - 1] || null;

  return (
    <div className={`app phase-${phase}`}>
      <header className="topbar">
        <div>
          <strong>Realtime Translate</strong>
          <p>同侧观看 · 左中文 / 右英文</p>
        </div>
        <span className="provider">{providerLabel}</span>
      </header>

      <div className="col-labels" aria-hidden="true">
        <span>中文</span>
        <span>English</span>
      </div>

      <main className="chat" ref={listRef}>
        {!turns.length ? (
          <div className="empty">
            <p>还没有对话</p>
            <p className="empty-sub">两人从同一侧看屏幕：左侧中文，右侧英文</p>
          </div>
        ) : (
          turns.map((turn, index) => {
            const { zh, en } = bilingualPair(turn);
            const isLatest = index === turns.length - 1;
            return (
              <section key={turn.id} className={`turn-row ${isLatest ? "latest" : ""}`}>
                <article className="bubble left">
                  <span className="lang-tag">中</span>
                  <p className="primary">{zh || "—"}</p>
                  {zh ? (
                    <button type="button" className="mini" disabled={busy} onClick={() => playTts(zh, "zh")}>
                      播报
                    </button>
                  ) : null}
                </article>
                <article className="bubble right">
                  <span className="lang-tag">EN</span>
                  <p className="primary">{en || "—"}</p>
                  {en ? (
                    <button type="button" className="mini" disabled={busy} onClick={() => playTts(en, "en")}>
                      Speak
                    </button>
                  ) : null}
                </article>
              </section>
            );
          })
        )}
      </main>

      {latest ? (
        <div className="latest-actions">
          <button type="button" disabled={busy} onClick={() => correctDirection(latest)}>
            纠正方向（{latest.direction}）
          </button>
          {latest.detected ? <span className="detect">已自动检测语种</span> : null}
        </div>
      ) : null}

      <footer className={`composer ${phase}`}>
        {isIOS || !speechSupported ? (
          <p className="ios-tip">iOS 请用打字；播报仍可用系统语音</p>
        ) : null}

        <div className="compose">
          <input
            type="text"
            value={draft}
            placeholder={langHint === "zh-CN" ? "输入中文或英文…" : "Type Chinese or English…"}
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
        </div>

        {speechSupported ? (
          <button
            type="button"
            className={`mic ${recording ? "hot" : ""} ${busy ? "busy" : ""}`}
            onClick={toggleRecord}
            disabled={busy && !recording}
            aria-pressed={recording}
          >
            <span className="mic-pulse" aria-hidden="true" />
            <span className="mic-label">{recording ? "结束" : busy ? "…" : "说话"}</span>
          </button>
        ) : null}

        <p className="status">{status}</p>
        {interim ? <p className="interim">{interim}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="toolbar">
          <button
            type="button"
            className="ghost"
            onClick={() => setLangHint((h) => (h === "zh-CN" ? "en-US" : "zh-CN"))}
            disabled={recording || busy}
          >
            下一句偏好：{langHint === "zh-CN" ? "中文" : "English"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={clearHistory}
            disabled={!turns.length || busy || recording}
          >
            清空
          </button>
          <span className="count">{turns.length} 轮</span>
        </div>
      </footer>
    </div>
  );
}
