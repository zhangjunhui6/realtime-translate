# Realtime Translate

面对面**轮流对话**翻译（MVP）：手机浏览器打开，中 ↔ 英。

## 共识（产品）

- 交互：轮流对话；左右/上下分栏
- 场景：先出国外语（中英）；方言后续扩展
- 载体：移动 Web / PWA
- 能力：云 API（默认 OpenAI）；无密钥时 mock
- 播报：文字为主，手动播报
- 方向：自动语种检测 + 一键纠正重译

## 本地运行

```bash
cd /home/tiger/work/realtime-translate
cp .env.example .env
# 可选：填入 OPENAI_API_KEY
npm install
npm run dev
```

- 前端：http://localhost:5173（Vite 代理 `/api` → 后端）
- 后端：http://localhost:8787

手机访问时用电脑局域网 IP，并确保后端 `HOST=0.0.0.0`；麦克风需要 HTTPS 或 localhost。

## 环境变量

见 `.env.example`。

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 有则走真实 ASR/翻译/TTS；无则 mock |
| `TRANSLATE_PROVIDER` | `openai` 或 `mock` |
| `RT_PORT` | 后端端口，默认 `8787`（不用系统 `PORT`，避免被环境污染） |
| `RT_HOST` | 监听地址，默认 `0.0.0.0` |

## 验收对照

- [ ] 手机浏览器轮流中英对话，分栏可读
- [ ] 手动播报可用
- [ ] 检测错误时可纠正方向并重译
- [ ] 密钥不暴露到前端
- [ ] 无麦权限 / 网络失败有提示
