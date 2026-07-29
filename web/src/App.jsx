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
  const nearListRef = useRef(null);
  const farListRef = useRef(null);
  const finalTranscriptRef = useRef("");

  const speechSupported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );
  const isIOS = useMemo(
    () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    [],
  );

  useEffect(() => {
    // Ensure trailing slash so relative asset URLs resolve under /s/xxxx/
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
    nearListRef.current?.scrollTo({
      top: nearListRef.current.scrollHeight,
      behavior: "smooth",
    });
    farListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [turns, busy, recording, interim]);

  useEffect(() => () => {
    recognitionRef.current?.abort?.();
    window.speechSynthesis?.cancel?.();
  }, []);

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
      ? "免密钥（翻译走 MyMemory）"
      : health.provider || "…";

  const phase = recording ? "listening" : busy ? "working" : "idle";

  return (
    <div className={`app phase-${phase}`}>
      <section className="pane pane-far" aria-label="对面一方">
        <header className="pane-head">
          <span className="lang-tag">EN</span>
          <span className="hint">对面看这边 ↑</span>
        </header>
        <HistoryList
          listRef={farListRef}
          turns={turns}
          side="en"
          reverse
          busy={busy}
          onSpeak={playTts}
          onCorrect={correctDirection}
        />
      </section>

      <section className="control">
        <div className="meta">
          <strong>Realtime Translate</strong>
          <span>中 ↔ 英 · 轮流对话</span>
          <span className="provider">{providerLabel}</span>
        </div>

        {isIOS || !speechSupported ? (
          <p className="ios-tip">iOS 网页无法可靠语音识别，请用下方打字；播报仍可用</p>
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
          <button type="button" className="send" disabled={busy || recording || !draft.trim()} onClick={() => void submitDraft()}>
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
            <span className="mic-label">
              {recording ? "结束" : busy ? "处理中" : "说话"}
            </span>
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
          <button type="button" className="ghost" onClick={clearHistory} disabled={!turns.length || busy || recording}>
            清空
          </button>
          <span className="count">{turns.length} 轮</span>
        </div>
      </section>

      <section className="pane pane-near" aria-label="靠近一方">
        <header className="pane-head">
          <span className="lang-tag">中文</span>
          <span className="hint">你看这边 ↓</span>
        </header>
        <HistoryList
          listRef={nearListRef}
          turns={turns}
          side="zh"
          busy={busy}
          onSpeak={playTts}
          onCorrect={correctDirection}
        />
      </section>
    </div>
  );
}

function HistoryList({
  listRef,
  turns,
  side,
  reverse = false,
  busy,
  onSpeak,
  onCorrect,
}) {
  const items = reverse ? [...turns].reverse() : turns;

  if (!turns.length) {
    return (
      <div className="empty">
        <p>还没有对话</p>
        <p className="empty-sub">中间输入框打字发送，或（非 iOS）点说话</p>
      </div>
    );
  }

  return (
    <div className="history" ref={listRef}>
      {items.map((turn, index) => {
        const latest = reverse ? index === 0 : index === items.length - 1;
        return (
          <TurnCard
            key={turn.id}
            turn={turn}
            side={side}
            latest={latest}
            busy={busy}
            onSpeak={onSpeak}
            onCorrect={onCorrect}
          />
        );
      })}
    </div>
  );
}

function TurnCard({ turn, side, latest, busy, onSpeak, onCorrect }) {
  const isSource = turn.sourceLang === side;
  const primary = isSource ? turn.sourceText : turn.translatedText;
  const secondary = isSource ? turn.translatedText : turn.sourceText;
  const primaryLang = side;
  const secondaryLang = side === "zh" ? "en" : "zh";
  const role = isSource ? "我说的" : "译给我的";

  return (
    <article className={`bubble ${isSource ? "mine" : "theirs"} ${latest ? "latest" : ""}`}>
      <div className="bubble-top">
        <span className="role">{role}</span>
        <span className="dir">{turn.direction}</span>
      </div>
      <p className="primary">{primary}</p>
      <p className="secondary">{secondary}</p>
      {latest ? (
        <div className="actions">
          <button type="button" disabled={busy || !primary} onClick={() => onSpeak(primary, primaryLang)}>
            播报
          </button>
          <button
            type="button"
            disabled={busy || !secondary}
            onClick={() => onSpeak(secondary, secondaryLang)}
          >
            播报原文
          </button>
          <button type="button" disabled={busy} onClick={() => onCorrect(turn)}>
            纠正方向
          </button>
        </div>
      ) : null}
      {latest && turn.detected ? <p className="detect">自动检测 · 不对就点纠正</p> : null}
    </article>
  );
}
