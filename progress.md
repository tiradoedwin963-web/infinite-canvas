# Progress

## 2026-08-05 - Task: 初始化无限画布工程基线

### What was done
- 初始化可运行的 Vinext/React 单页工程，并建立统一开发规范、项目边界和本地开发文档。

### Testing
- `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`：通过，依赖安装完成。
- `npm run dev`：通过，本地开发服务启动于 `http://localhost:3000/`。
- `npm test`：通过，脚手架构建及服务端渲染测试共 2 项通过。

### Notes
- `AGENTS.md`：写入仓库统一执行规范及 A/B 分支职责边界。
- `docs/canvas.md`：记录画布范围、分支职责、本地运行和验证方式。
- `progress.md`：建立只追加的任务进度日志。
- 其余工程文件：由 Sites Vinext 标准脚手架初始化。
- 回滚方式：将仓库回退到本任务的父提交；由于本任务是首个提交，也可删除该提交后恢复为空仓库。

## 2026-08-05 - Task: 实现基础空白无限画布

### What was done
- 在 `codex/canvas-a` 实现全屏浅色点阵画布，支持鼠标、触控笔和单指拖动平移，以及围绕指针位置的 25%–400% 缩放。
- 移除脚手架预览、鉴权、数据库和示例占位，仅保留当前画布所需的运行表面与依赖。
- 将视口计算拆为可测试的纯函数，并更新服务端渲染与视口行为测试。

### Testing
- `npm run lint`：通过，无 ESLint 错误。
- `npm test`：通过，Vinext 构建成功，服务端渲染和视口行为共 5 项测试全部通过。
- `git diff --check`：通过，无空白符错误。
- `npm run dev`：通过，最终画布在 `http://localhost:3000/` 返回 HTTP 200。

### Notes
- `README.md`：替换脚手架说明，记录画布本地运行与验证入口。
- `app/page.tsx`：实现空白画布的指针拖动和滚轮缩放输入。
- `app/canvas/viewport.ts`：新增平移、缩放边界及定点缩放计算。
- `app/globals.css`：实现全屏暖白背景、低对比点阵和抓取光标。
- `app/layout.tsx`：设置中文页面语言、画布标题和描述。
- `tests/rendered-html.test.mjs`：改为验证画布页面及脚手架清理结果。
- `tests/viewport.test.mjs`：新增平移、缩放范围和锚点稳定性测试。
- `package.json`：更新项目名称、测试入口并移除未使用依赖与数据库脚本。
- `package-lock.json`：同步当前最小依赖集合。
- `app/_sites-preview/SkeletonPreview.tsx`：删除脚手架加载界面。
- `app/_sites-preview/preview.css`：删除脚手架加载样式。
- `app/chatgpt-auth.ts`：删除未使用的鉴权占位实现。
- `db/index.ts`：删除未使用的数据库入口。
- `db/schema.ts`：删除未使用的数据库结构占位。
- `drizzle.config.ts`：删除未使用的数据库生成配置。
- `drizzle/meta/_journal.json`：删除未使用的迁移记录占位。
- `examples/d1/app/api/notes/route.ts`：删除未使用的数据库接口示例。
- `examples/d1/db/schema.ts`：删除未使用的数据库示例结构。
- `public/favicon.svg`：删除未使用的脚手架图标。
- `public/file.svg`：删除未使用的脚手架图标。
- `public/globe.svg`：删除未使用的脚手架图标。
- `public/window.svg`：删除未使用的脚手架图标。
- `progress.md`：追加本轮实现与验证记录。
- 回滚方式：执行 `git revert $(git log --grep='feat: add empty infinite canvas' --format=%H -n 1)`。
