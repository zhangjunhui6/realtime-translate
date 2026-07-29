# Realtime Translate（对面 · FaceTalk）

面对面**轮流对话**翻译：手机浏览器打开，中 ↔ 英。支持顶部切换多种方案。

## 方案切换

| 方案 | 翻译 | 语音 | 环境变量 |
| --- | --- | --- | --- |
| `local` | Google gtx 免密 | 浏览器 Web Speech | 无 |
| `youdao` | 有道文本翻译 | 有道短语音识别 | `YOUDAO_APP_KEY` / `YOUDAO_APP_SECRET` |
| `xunfei` | 讯飞机器翻译 | 讯飞语音听写 | `XUNFEI_APP_ID` / `API_KEY` / `API_SECRET` |
| `volcano` | 火山方舟 Chat 翻译 | 浏览器（暂无云 ASR） | `VOLC_ARK_API_KEY` / `VOLC_ARK_MODEL` |

TTS 默认用系统 `speechSynthesis`。

## 本地运行

```bash
cd /home/tiger/work/realtime-translate
cp .env.example .env
npm install
npm run build
npm start
```

- 开发：`npm run dev`（前端 5173，后端见 `.env` 的 `RT_PORT`）
- 生产：后端静态托管 `web/dist`，默认端口 `PORT` 或 `RT_PORT`

## 免费云部署（Render）

已提供 `Dockerfile`（含 ffmpeg）与 `render.yaml`。

1. 推送到 GitHub
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → 选仓库
3. 在 Environment 填密钥（不要提交进 Git）：
   - `YOUDAO_APP_KEY` / `YOUDAO_APP_SECRET`
   - `XUNFEI_APP_ID` / `XUNFEI_API_KEY` / `XUNFEI_API_SECRET`
   - `VOLC_ARK_API_KEY` / `VOLC_ARK_MODEL`
   - 可选 `TRANSLATE_PROVIDER=xunfei`（或 `local` / `youdao`）
4. 部署完成后打开 `https://xxx.onrender.com`

注意：Render 免费档闲置会休眠，冷启动约 30–60 秒。
