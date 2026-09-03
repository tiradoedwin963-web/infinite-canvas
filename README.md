# Zora Star 创作空间

Zora Star 的桌面端产品原型，使用 Vinext、React 和 TypeScript 构建。产品壳提供生图、生视频和画布三个独立入口；生图与生视频当前只运行本地模拟任务，不调用媒体接口，画布入口保留既有创作、工作流和 Agent 能力。

本仓库公开用于查看与协作，当前未配置开源许可证。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

运行前在被 Git 忽略的 `.env.local` 中配置 `LINGKE_BASE_URL` 和 `LINGKE_API_KEY`。服务端密钥不得进入客户端代码或提交到仓库；生产部署的公网入口当前关闭登录，只应提供给受信任人员。

## 验证

```bash
npm run lint
npm test
```

产品壳原型说明见 [`docs/product-shell.md`](docs/product-shell.md)，画布交互与分支职责见 [`docs/canvas.md`](docs/canvas.md)。

北京服务器的 Docker 部署、更新和回滚流程见 [`docs/deployment.md`](docs/deployment.md)。
