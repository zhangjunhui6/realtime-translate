import { useCallback, useEffect, useRef, useState } from "react";

const MAX_TURNS = 40;

export default function App() {
  const [health, setHealth] = useState(null);
  const [turns, setTurns] = useState([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("点「说话」开始 · 再说一次结束");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const nearListRef = useRef(null);
  const farListRef = useRef(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, mock: true }));
  }, []);

  useEffect(() => {
    nearListRef.current?.scrollTo({
      top: nearListRef.current.scrollHeight,
      behavior: "smooth",
    });
    // Far pane is rotated 180deg: scrollTop 0 is visually at the "bottom" for the other person
    farListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [turns, busy, recording]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const appendTurn = useCallback((turn) => {
    setTurns((prev) => [...prev, turn].slice(-MAX_TURNS));
  }, []);

  const startRecording = async () => {
    setError("");
    if (busy) return;
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
        await submitTurn(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setStatus("正在聆听…说完再点一次");
    } catch (err) {
      console.error(err);
      setError("无法使用麦克风（需 HTTPS 或 localhost，并允许权限）");
      setStatus("点「说话」开始 · 再说一次结束");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
    setStatus("识别与翻译中…");
  };

  const toggleRecord = () => {
    if (recording) stopRecording();
    else void startRecording();
  };

  const submitTurn = async (blob) => {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/turn", { method: "POST", body: form });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "重译失败");
    } finally {
      setBusy(false);
    }
  };

  const playTts = async (text, lang) => {
    setError("");
    try {
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
  };

  const providerLabel = !health
    ? "检测中…"
    : health.mock
      ? "mock（未配置密钥）"
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
          <span className={`provider ${health?.mock ? "warn" : ""}`}>
            {providerLabel}
          </span>
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
        {error ? <p className="error">{error}</p> : null}

        <div className="toolbar">
          <button type="button" className="ghost" onClick={clearHistory} disabled={!turns.length || busy || recording}>
            清空历史
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
        <p className="empty-sub">中间按钮录音，说完再点一次</p>
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
