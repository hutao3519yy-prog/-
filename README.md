# 帧造 · 短剧海报导演

上传 Word 剧本和人物参考图，自动完成剧情分析、海报提示词编排与 GPT Image 2 成片生成。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000`。未配置 API Key 时会进入演示模式，完整体验剧本上传、提示词和结果流程。

## 接入 OpenAI

在 `.env` 中设置：

```env
OPENAI_API_KEY=你的_API_Key
OPENAI_TEXT_MODEL=gpt-5.4-mini
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_PROXY_URL=
CHATGPT_MANUAL_MODE=false
```

API Key 只在服务端读取，不会发送到浏览器，也不要把 `.env` 提交到 Git。

如果本机不能直连 OpenAI API，但代理端口可用，可以把 `OPENAI_PROXY_URL` 设为本地代理地址，例如 `http://127.0.0.1:7897`。项目启动脚本会自动让 Node 请求走该代理。

如果 API 暂时没有额度，可以把 `CHATGPT_MANUAL_MODE` 设为 `true`。网站会跳过 API 调用，直接生成可复制到 ChatGPT 的海报生成包。

## 已实现

- `.docx` / `.doc` 上传与正文提取（旧 `.doc` 建议另存为 `.docx`）
- AI 提炼剧名、核心冲突、人物关系与视觉气质
- 自动、双人张力、多人群像三种海报模式
- 11 类可视化风格库，覆盖豪门、虐恋、悬疑、群像、王室、奇幻等方向
- 固定 9:16 比例，并按平台规范精确锁定封面信息区、数据区与上下裁切区
- 多张人物参考图传给 GPT Image 2 编辑接口
- 1–4 个构图版本与成片下载
- 无 API Key 的本地演示模式

## 说明

ChatGPT 订阅和 OpenAI API 是两套独立的计费与鉴权体系。网站不能直接复用 ChatGPT 客户端登录状态；正式生成需要 OpenAI Platform API Key。
