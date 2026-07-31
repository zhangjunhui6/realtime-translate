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

仓库已含 `render.yaml`（**免费 Node 运行时**，不依赖 Docker）。

> 注意：Render **免费档通常不能部署 Docker Web Service**。若 Blueprint 报 `deploy failed` 且 runtime 是 Docker，请改用下面 Node 方式，或点 Manual sync 拉取最新 `render.yaml`。

### 推荐：New → Web Service（Node）

1. 打开 [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**
2. 连接 GitHub 仓库 `zhangjunhui6/realtime-translate`，Branch：`master`
3. Runtime：**Node**
4. Build Command：`npm ci && npm run build -w web`
5. Start Command：`node server/src/index.js`
6. Instance：**Free**；Health Check Path：`/api/health`
7. Environment：
   - `RT_HOST=0.0.0.0`
   - `TRANSLATE_PROVIDER=local`（先免密钥跑通）
   - 需要有道/讯飞时再填对应密钥（**不要**提交进 Git）
8. Create Web Service → 得到 `https://xxx.onrender.com`

### 或：Blueprint

1. **New** → **Blueprint** → 选本仓库
2. Blueprint Name：任意（如 `realtime-translate`）
3. Blueprint Path：`render.yaml`；Branch：`master`
4. 若曾失败：先删掉失败服务，再 Manual sync / 重建

免费 Node 环境一般**没有 ffmpeg**：云端录音 ASR（有道/讯飞）可能不可用；打字翻译与本地方案可用。完整云端 ASR 需付费 Docker（仓库仍保留 `Dockerfile`）。

注意：免费档闲置会休眠，冷启动约 30–60 秒。

