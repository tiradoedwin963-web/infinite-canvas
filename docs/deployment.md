# 画布服务器部署

当前北京服务器在备案完成前使用独立 Docker 项目部署画布，不接入现有 Python 项目的 Caddy，也不占用 80/443。画布入口固定为 `https://82.157.204.208:3011`，使用 Caddy 内部 CA签发的自签名证书；Caddy Basic Auth 是第一层保护，应用账号是第二层保护。

## 边界

- 安装目录：`/opt/infinite-canvas`
- Git 分支：`main`
- 容器：`infinite-canvas-app-1`、`infinite-canvas-caddy-1`、`infinite-canvas-postgres-1`
- 公网端口：仅新增 TCP 3011
- 现有 `/opt/wecom-smart-service`、Python API、Worker、PostgreSQL、Redis 及其数据卷不得修改或重启
- 画布 PostgreSQL 使用独立数据卷且不发布端口，不连接现有 Python 项目的 PostgreSQL
- 工作流图片和视频保存到北京地域的私有腾讯云 COS，匿名读取被拒绝
- 工作流画布使用 COS 派生的 640px WebP 缩略图；详情、Agent 读图和生成参考仍读取原图
- 模型密钥、Basic Auth 哈希、数据库密码、管理员哈希和 COS 密钥只保存在服务器 `.env.production`，权限固定为 `600`

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
CANVAS_DATABASE_PASSWORD=随机数据库强密码
CANVAS_ADMIN_PASSWORD_HASH='scrypt 管理员密码哈希'
COS_REGION=ap-beijing
COS_BUCKET=infinite-canvas-腾讯云AppID
COS_SECRET_ID=仅限画布桶的CAM子用户SecretId
COS_SECRET_KEY=仅限画布桶的CAM子用户SecretKey
```

Basic Auth 用户名固定为 `canvas`，应用管理员用户名固定为 `admin`。两个初始密码分别随机生成，服务端只保存 Caddy bcrypt 哈希和应用 scrypt 哈希，明文密码仅在交付时展示一次。应用不开放公众注册；管理员登录后可创建、停用账号和重置密码，停用或重置会撤销该账号已有会话。

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

应用启动前会执行 `npm run db:migrate`，迁移脚本使用 PostgreSQL advisory lock 和迁移记录表，多个容器同时启动也不会重复执行。数据库与 Caddy 卷不得通过 `down -v` 删除。
登录等写请求会根据 Caddy 传入的 `X-Forwarded-Proto` 和 `X-Forwarded-Host` 校验公网同源；应用容器的 `3000` 端口必须继续只存在于 Compose 内网，不得直接发布到宿主机或公网。

未通过 Basic Auth 的请求应返回 `401`；通过 Basic Auth 后首页返回 `200` 并显示应用登录页：

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

首次升级到缩略图版本后，执行幂等补建脚本。脚本最多同时处理两张图片，已存在的缩略图会跳过，不调用图片生成接口：

```bash
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml exec -T app \
npm run assets:backfill-thumbnails
```

生产构建仅在需要创建缺失缩略图时于 Node 运行时加载 Sharp，由镜像中的原生模块执行转换；读取已存在缩略图不会加载原生转换器。不要把 Sharp 的原生加载器打包进 Vinext 服务端产物，否则 Alpine 无法选择对应的原生二进制。

更新后重新检查容器、未认证 `401`、认证 `200` 和日志：

```bash
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml ps
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml logs --no-color --tail=100 app caddy postgres
```

## 项目与素材迁移

本地旧项目先从工作流项目菜单导出为 `*.canvas.json`。正式迁移必须同时提供完整素材清单；把迁移目录复制到应用容器后执行导入工具：

```bash
docker cp /opt/infinite-canvas-migration infinite-canvas-app-1:/migration
docker compose --env-file .env.production -f deploy/canvas/compose.production.yml exec -T app \
  node scripts/import-workflow-project.mjs /migration/project.canvas.json /migration/manifest.json
```

导入工具先校验节点和素材映射，再逐张上传并通过 COS `HeadObject` 校验大小与类型，最后用单个数据库事务写入管理员项目；任一图片缺失或数据库写入失败会删除本次已上传对象，不留下半套项目。迁移时会清除旧任务 ID、批量队列及提交中状态，避免刷新后重复生成或计费。

## 备份与健康检查

- 更新 `.env.production` 前创建权限为 `600` 的服务器本地备份，不输出变量值。
- PostgreSQL 数据保存在独立 `postgres_data` 卷；代码回滚不会删除数据库和 COS 对象。
- 素材读取必须经过应用账号鉴权；视频接口保留 `Range` 请求和 `206` 响应。
- 图片缩略图与原图使用相同账号鉴权；删除素材或项目会同时清理两类 COS 对象。
- 检查画布容器前后都应记录 `/opt/wecom-smart-service` 的 API、Worker、PostgreSQL、Redis 状态，禁止重启或修改它们。

## 回滚

应用异常时先停止本项目，不删除卷：

```bash
cd /opt/infinite-canvas
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml stop app caddy
```

确认需要回退的历史提交后，在 GitHub 使用 `git revert` 产生可审计的回滚提交，再由服务器 `fetch` 和 `merge --ff-only` 更新。数据库和 COS 数据保留，禁止强推 `main`，禁止执行 `docker compose down -v`，也不得操作 `wecom-smart-service` Compose 项目。
