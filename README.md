# 无限画布

一个接入 LingkeAI 文本、图片和视频模型的生成画布，使用 Vinext、React 和 TypeScript 构建。提交文字和参考图后，画布会自动创建输入节点、生成结果节点和来源连线。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

运行前在被 Git 忽略的 `.env.local` 中配置 `LINGKE_BASE_URL` 和 `LINGKE_API_KEY`。当前版本仅供本机或私有环境使用，不应携带服务端密钥公开部署。

## 验证

```bash
npm run lint
npm test
```

详细交互与分支职责见 [`docs/canvas.md`](docs/canvas.md)。
