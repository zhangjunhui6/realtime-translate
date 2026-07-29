import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_TURNS = 40;

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
  const [status, setStatus] = useState("点「说话」开始 · 再说一次结束");
  const [langHint, setLangHint] = useState("zh-CN");
  const [interim, setInterim] = useState("");

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const nearListRef = useRef(null);
  const farListRef = useRef(null);
  const finalTranscriptRef = useRef("");

  const browserSpeech = health?.browserSpeech !== false;
  const speechSupported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  useEffect(() => {
    fetch("/api/health")
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
    // Chrome loads voices asynchronously
    window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});
  }, []);

  useEffect(() => {
    nearListRef.current?.scrollTo({
      top: nearListRef.current.scrollHeight,
      behavior: "smooth",
    });
    farListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [turns, busy, recording, interim]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    stopStream();
    recognitionRef.current?.abort?.();
    window.speechSynthesis?.cancel?.();
  }, [stopStream]);

  const appendTurn = useCallback((turn) => {
    setTurns((prev) => [...prev, turn].slice(-MAX_TURNS));
    setLangHint(turn.direction === "zh2en" ? "en-US" : "zh-CN");
  }, []);

  const translateText = async (sourceText, forceDirection = null) => {
    setBusy(true);
    setError("");
    setStatus("翻译中…");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, forceDirection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "翻译失败");
      appendTurn({ id: crypto.randomUUID(), ...data });
      setStatus("点「说话」开始 · 再说一次结束");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "网络或服务异常");
      setStatus("点「说话」开始 · 再说一次结束");
    } finally {
      setBusy(false);
    }
  };

  const startBrowserListen = () => {
    setError("");
    if (!speechSupported) {
      setError("当前浏览器不支持语音识别，请用手机 Chrome（推荐 Android）");
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
    recognition.onend = () => {
      // If user stopped intentionally we handle in stopBrowserListen.
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
      setError("没有听清，请靠近麦克风再说一次");
      setStatus("点「说话」开始 · 再说一次结束");
      return;
    }
    await translateText(text);
  };

  const startServerRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size < 256) {
          setError("录音太短，请再说长一点");
          setStatus("点「说话」开始 · 再说一次结束");
          return;
        }
        setBusy(true);
        setStatus("识别与翻译中…");
        try {
          const form = new FormData();
          form.append("audio", blob, "speech.webm");
          const res = await fetch("/api/turn", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "翻译失败");
          appendTurn({ id: crypto.randomUUID(), ...data });
          setStatus("点「说话」开始 · 再说一次结束");
        } catch (err) {
          setError(err instanceof Error ? err.message : "网络或服务异常");
          setStatus("点「说话」开始 · 再说一次结束");
        } finally {
          setBusy(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setStatus("正在聆听…说完再点一次");
    } catch {
      setError("无法使用麦克风（需 HTTPS 或 localhost）");
    }
  };

  const stopServerRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  };

  const toggleRecord = () => {
    if (recording) {
      if (browserSpeech) void stopBrowserListen();
      else stopServerRecording();
      return;
    }
    if (busy) return;
    if (browserSpeech) startBrowserListen();
    else void startServerRecording();
  };

  const correctDirection = async (turn) => {
    const direction = turn.direction === "zh2en" ? "en2zh" : "zh2en";
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/retranslate", {
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
      if (health?.browserTts !== false) {
        await speakBrowser(text, lang);
        return;
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "播报失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
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
      ? "免密钥（浏览器语音 + MyMemory）"
      : health.mock
        ? "mock"
        : health.provider || "openai";

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

        <p className="status">{status}</p>
        {interim ? <p className="interim">{interim}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {browserSpeech && !speechSupported ? (
          <p className="error">建议使用手机 Chrome；iOS Safari 对语音识别支持很差</p>
        ) : null}

        <div className="toolbar">
          <button
            type="button"
            className="ghost"
            onClick={() => setLangHint((h) => (h === "zh-CN" ? "en-US" : "zh-CN"))}
            disabled={recording || busy}
          >
            下一句识别：{langHint === "zh-CN" ? "中文" : "English"}
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
        <p className="empty-sub">中间按钮开始说，说完再点一次</p>
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
