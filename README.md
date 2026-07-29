# Realtime Translate

面对面**轮流对话**翻译（MVP）：手机浏览器打开，中 ↔ 英。

## 当前默认（无需 OpenAI）

- **语音识别 / 播报**：手机浏览器自带（Web Speech + Speech Synthesis）
- **翻译**：MyMemory 免密接口（有日额度；服务端代理）
- 推荐：**Android Chrome**；iOS Safari 对语音识别支持很差

有 `OPENAI_API_KEY` 时可把 `TRANSLATE_PROVIDER=openai`，改走云端 ASR/翻译/TTS。

## 本地运行

```bash
cd /home/tiger/work/realtime-translate
cp .env.example .env
npm install
npm run dev
```

- 前端：http://localhost:5173（Vite 代理 `/api` → 后端）
- 后端：http://localhost:8787

手机访问请用电脑局域网 IP，并尽量 **HTTPS**（或 Chrome 对 localhost 的例外）；麦克风/语音识别需要安全上下文。

## 免费云部署（Render）

1. 把本仓库推到 GitHub
2. 打开 [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**，选本仓库（或 New Web Service + Docker）
3. 使用仓库里的 `render.yaml` / `Dockerfile`
4. 部署完成后得到 `https://xxx.onrender.com`（自动 HTTPS）

说明：Free 实例闲置约 15 分钟会休眠，冷启动可能 30–60 秒。

| 变量 | 说明 |
|------|------|
| `TRANSLATE_PROVIDER` | `mymemory`（默认免密）/ `openai` / `mock` |
| `OPENAI_API_KEY` | 仅 openai 模式需要 |
| `RT_PORT` | 本地/mlx 端口；云上可省略，用平台 `PORT` |
| `RT_HOST` | 监听地址，云上用 `0.0.0.0` |
| `PORT` | Render/Fly 自动注入 |

## 验收对照

- [ ] 手机 Chrome：两人轮流中英对话，译文可读
- [ ] 手动播报可用；方向错了可纠正
- [ ] 无 OpenAI key 也能跑（mymemory）
- [ ] 无麦权限 / 网络失败有提示
