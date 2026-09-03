# Zora Star 服务器部署

当前北京服务器在备案完成前使用独立 Docker 项目部署 Zora Star，不接入现有 Python 项目的 Caddy，也不占用 80/443。产品入口固定为 `https://82.157.204.208:3011/image`，使用 Caddy 内部 CA 签发的自签名证书；生产环境已关闭 Caddy 与应用两层登录，入口直接显示生图工作区，画布位于 `/canvas`。

## 边界

- 安装目录：`/opt/infinite-canvas`
- Git 分支：`main`
- 容器：`infinite-canvas-app-1`、`infinite-canvas-caddy-1`、`infinite-canvas-postgres-1`
- 公网端口：仅新增 TCP 3011
- 现有 `/opt/wecom-smart-service`、Python API、Worker、PostgreSQL、Redis 及其数据卷不得修改或重启
- 画布 PostgreSQL 使用独立数据卷且不发布端口，不连接现有 Python 项目的 PostgreSQL
- 工作流图片和视频保存到北京地域的私有腾讯云 COS，匿名读取被拒绝
- 工作流画布使用 COS 派生的 640px WebP 缩略图；详情、Agent 读图和生成参考仍读取原图
- 模型密钥、数据库密码和 COS 密钥只保存在服务器 `.env.production`，权限固定为 `600`
- 应用登录关闭时，所有云端请求均使用既有 `admin` 账号访问其已有项目和素材；不要将该公网入口提供给非受信任人员

## TRX 视频原图直签

SD 2.5 视频提交只使用当前账号、当前云端项目中已经归档且校验完成的图片原图。应用按调度器连线顺序校验素材归属、类型和大小，确认 COS 原对象存在后，直接为该对象签发 24 小时私有读 URL 交给 TRX 视频网关。

此流程不会复制、写入或删除视频参考对象，也不需要 `temporary/` 前缀或 COS 生命周期规则。原图和缩略图继续沿用既有私有桶、对象键和删除策略，禁止将桶或对象改为公开读。

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
TRX_VIDEO_BASE_URL=https://trxdoc.xin
TRX_VIDEO_API_KEY=TRX 企业 API Key（ek- 前缀）
CANVAS_DATABASE_PASSWORD=随机数据库强密码
COS_REGION=ap-beijing
COS_BUCKET=infinite-canvas-腾讯云AppID
COS_SECRET_ID=仅限画布桶的CAM子用户SecretId
COS_SECRET_KEY=仅限画布桶的CAM子用户SecretKey
```

生产 Compose 固定设置 `CANVAS_AUTH_DISABLED=true`，入口不再设置 Caddy Basic Auth，也不再显示应用登录、退出或账号管理控件。服务端会把每个云端请求绑定到既有、未停用的 `CANVAS_ADMIN_USERNAME`（生产固定为 `admin`），不读取或重置任何密码、用户或项目。

关闭登录前必须确认该管理员已经存在且处于启用状态。启动迁移会只读校验这项前提；如果找不到该账号，应用会停止启动而不会创建、删除或修改任何用户和项目。若要恢复应用登录，先在 Compose 中移除 `CANVAS_AUTH_DISABLED`，再恢复 `CANVAS_ADMIN_PASSWORD_HASH` 环境变量并重建 app 容器。

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

SD 2.5 只使用 TRX 原生视频接口：应用会先查询 `GET /v1/models`，再按需调用 `/v1/video/generate`。TRX 视频提交不幂等，部署或健康检查不得提交视频；部署后只允许进行无费用模型列表查询。

根路径应返回 `307` 并跳转到 `/image`，生图入口应返回 `200`：

```bash
curl -k -o /dev/null -s -w '%{http_code}\n' https://82.157.204.208:3011/
curl -k -o /dev/null -s -w '%{http_code}\n' https://82.157.204.208:3011/image
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

更新后重新检查容器、根路径 `307`、`/image` 与 `/canvas` 的 `200` 和日志：

```bash
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml ps
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml logs --no-color --tail=100 app caddy postgres
```

## 项目与素材迁移

本地项目从工作流项目菜单导出为完整 `*.canvas.json` 后，可在云端项目菜单选择“导入本地项目到云端”。导入会创建一个新的 admin 项目，逐张通过现有上传票据写入同一私有 COS 桶并完成大小、类型校验，再将图中的本地素材 ID 重写为云端资产 ID。

导入要求文件携带全部被图引用的图片；TVC 分镜、锁稿、手动覆盖及 `submission-unknown` 证据会保留，批量队列不会恢复，也不会自动提交或轮询媒体。任一上传、素材重写、项目图或对话保存失败时，只删除本次新建的云端项目及其对象，本地原项目保持不变。

## 备份与健康检查

- 更新 `.env.production` 前创建权限为 `600` 的服务器本地备份，不输出变量值。
- PostgreSQL 数据保存在独立 `postgres_data` 卷；代码回滚不会删除数据库和 COS 对象。
- COS 原图和缩略图仍保持私有；应用在关闭登录模式下以固定 admin 身份读取它们，视频接口保留 `Range` 请求和 `206` 响应。
- 图片缩略图与原图使用相同的固定 admin 项目归属校验；删除素材或项目会同时清理两类 COS 对象。
- 检查画布容器前后都应记录 `/opt/wecom-smart-service` 的 API、Worker、PostgreSQL、Redis 状态，禁止重启或修改它们。

## 回滚

应用异常时先停止本项目，不删除卷：

```bash
cd /opt/infinite-canvas
sudo docker compose --env-file .env.production \
  -f deploy/canvas/compose.production.yml stop app caddy
```

确认需要回退的历史提交后，在 GitHub 使用 `git revert` 产生可审计的回滚提交，再由服务器 `fetch` 和 `merge --ff-only` 更新。数据库和 COS 数据保留，禁止强推 `main`，禁止执行 `docker compose down -v`，也不得操作 `wecom-smart-service` Compose 项目。
