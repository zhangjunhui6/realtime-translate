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
  const mediaRecorderRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
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
  const cloudAsr = Boolean(health?.cloudAsr);
  const canRecord = cloudAsr || speechSupported;
  const providers = Array.isArray(health?.providers) ? health.providers : [];

  const switchProvider = async (id) => {
    if (!id || busy || recording || id === health?.provider) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl("api/provider"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "切换失败");
      setHealth((prev) => ({
        ...(prev || {}),
        ...data,
        providers: data.providers || prev?.providers,
      }));
      setStatus(
        data.cloudAsr
          ? "已切换云端方案：点说话上传识别"
          : "已切换本地方案：浏览器识别 + 免密翻译",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败");
    } finally {
      setBusy(false);
    }
  };

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
      .catch(() => setHealth({ ok: false, provider: "googlegtx", browserSpeech: true, cloudAsr: false }));
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
      try {
        mediaRecorderRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop());
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

  const submitCloudAudio = async (blob) => {
    setBusy(true);
    setError("");
    setStatus("上传录音…");
    const statusTimer = window.setTimeout(() => setStatus("云端识别中…"), 400);
    const statusTimer2 = window.setTimeout(() => setStatus("翻译中…"), 1600);
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4")
        ? "m4a"
        : blob.type.includes("wav")
          ? "wav"
          : "webm";
      form.append("audio", blob, `speech.${ext}`);
      const res = await fetch(apiUrl("api/turn"), {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "语音翻译失败");
      await appendTurn({ id: crypto.randomUUID(), ...data });
      const totalMs = data?.timings?.totalMs;
      setStatus(
        totalMs
          ? `完成（约 ${(totalMs / 1000).toFixed(1)}s）· 继续说下一句`
          : "继续说下一句（云端识别 + 自动互译）",
      );
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "网络或服务异常");
      setStatus("自动识别中/英，互译给对方");
    } finally {
      window.clearTimeout(statusTimer);
      window.clearTimeout(statusTimer2);
      setBusy(false);
    }
  };

  const startCloudListen = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风录音，请打字");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "",
      ];
      let recorder = null;
      for (const mime of mimeCandidates) {
        try {
          recorder = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
          break;
        } catch {
          /* try next */
        }
      }
      if (!recorder) {
        stream.getTracks().forEach((t) => t.stop());
        setError("无法启动录音");
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data?.size) mediaChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setStatus("正在听…说完再点一次（云端识别）");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && /Permission|NotAllowed/i.test(err.message)
          ? "请允许麦克风权限后再试"
          : "无法打开麦克风，请打字",
      );
    }
  };

  const stopCloudListen = async () => {
    const recorder = mediaRecorderRef.current;
    setRecording(false);
    if (!recorder) {
      mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop());
      return;
    }
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        resolve(new Blob(mediaChunksRef.current, { type }));
      };
      try {
        recorder.stop();
      } catch {
        resolve(new Blob([], { type: "audio/webm" }));
      }
    });
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaChunksRef.current = [];
    if (!blob.size) {
      setError("没有录到声音，请再说一次或改用打字");
      setStatus("自动识别中/英，互译给对方");
      return;
    }
    await submitCloudAudio(blob);
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
      if (cloudAsr) void stopCloudListen();
      else void stopBrowserListen();
      return;
    }
    if (busy) return;
    if (cloudAsr) void startCloudListen();
    else startBrowserListen();
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
    : health.label ||
      (health.provider === "youdao"
        ? "有道智云"
        : health.provider === "local" || health.provider === "googlegtx"
          ? "本地最快"
          : health.provider || "就绪");

  const phase = recording ? "listening" : busy ? "working" : "idle";
  const latest = turns[turns.length - 1] || null;
  const micHint = cloudAsr
    ? "点麦克风说话：云端识别 + 自动互译；也可打字"
    : isIOS || !speechSupported
      ? "本地方案：iPhone 请打字（网页语音识别弱）；Android 可说话"
      : "本地方案：可打字或点麦克风（浏览器识别）";

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

      {providers.length ? (
        <div className="provider-row" aria-label="翻译方案">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`provider-chip ${p.active ? "active" : ""} ${p.ready ? "" : "disabled"}`}
              disabled={!p.ready || busy || recording}
              title={p.hint || p.label}
              onClick={() => void switchProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}

      <p className="lede">
        可切换：本地最快 / 有道 / 讯飞。同侧阅读，左中文右英文。
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
        <p className="hint">{micHint}</p>
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
          {canRecord ? (
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
