# 画布服务器部署

当前北京服务器在备案完成前使用独立 Docker 项目部署画布，不接入现有 Python 项目的 Caddy，也不占用 80/443。画布入口固定为 `https://82.157.204.208:3011`，使用 Caddy 内部 CA签发的自签名证书，并通过 Basic Auth 保护页面和全部 API。

## 边界

- 安装目录：`/opt/infinite-canvas`
- Git 分支：`main`
- 容器：`infinite-canvas-app-1`、`infinite-canvas-caddy-1`
- 公网端口：仅新增 TCP 3011
- 现有 `/opt/wecom-smart-service`、Python API、Worker、PostgreSQL、Redis 及其数据卷不得修改或重启
- `LINGKE_API_KEY`、`LINGKE_BASE_URL` 和 Basic Auth 哈希只保存在服务器 `.env.production`，权限固定为 `600`

浏览器首次访问会提示证书不受信任；备案和域名准备完成后，应切换到可信域名证书和标准 443 入口。

## 首次部署

服务器使用 GitHub 仓库的只读 Deploy Key 克隆私有仓库，并把该密钥固定到当前仓库：

```bash
sudo install -d -o ubuntu -g ubuntu /opt/infinite-canvas
GIT_SSH_COMMAND='ssh -i /home/ubuntu/.ssh/infinite_canvas_deploy_ed25519 -o IdentitiesOnly=yes' \
  git clone git@github.com:tiradoedwin963-web/infinite-canvas.git /opt/infinite-canvas
git -C /opt/infinite-canvas config core.sshCommand \
  'ssh -i /home/ubuntu/.ssh/infinite_canvas_deploy_ed25519 -o IdentitiesOnly=yes'
git -C /opt/infinite-canvas switch main
```

在 `/opt/infinite-canvas/.env.production` 配置：

```text
LINGKE_BASE_URL=服务端模型地址
LINGKE_API_KEY=服务端模型密钥
CANVAS_BASIC_AUTH_HASH='Caddy bcrypt 哈希'
```

Basic Auth 用户名固定为 `canvas`。生成密码与哈希后，只保存哈希，明文密码仅在交付时展示一次。

启动并检查：

```bash
cd /opt/infinite-canvas
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml config --quiet
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml up -d --build
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml ps
```

未认证请求应返回 `401`，认证后的首页应返回 `200`：

```bash
curl -k -o /dev/null -s -w '%{http_code}\n' https://82.157.204.208:3011/
curl -k -u 'canvas:访问密码' -o /dev/null -s -w '%{http_code}\n' \
  https://82.157.204.208:3011/
```

## 更新

服务器只跟随 `origin/main`，更新前必须保持工作区干净：

```bash
cd /opt/infinite-canvas
git status --short
git fetch origin main
git merge --ff-only origin/main
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml up -d --build
```

更新后重新检查容器、未认证 `401`、认证 `200` 和日志：

```bash
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml ps
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml logs --no-color --tail=100 app caddy
```

## 回滚

应用异常时先停止本项目，不删除卷：

```bash
cd /opt/infinite-canvas
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml stop app caddy
```

确认需要回退的历史提交后，在 GitHub 使用 `git revert` 产生可审计的回滚提交，再由服务器 `fetch` 和 `merge --ff-only` 更新。禁止强推 `main`，禁止执行 `docker compose down -v`，也不得操作 `wecom-smart-service` Compose 项目。
