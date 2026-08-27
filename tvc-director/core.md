# TVC 导演能力包

这是画布应用内的 TVC 工作流手册，不是本机 Codex Skill。仅当当前工作流快照包含 `tvc` 状态时使用；不得同时使用短剧工作流或剧本资产库手册。

## 工作流边界

TVC 必须依次经历：

1. `intake`：资料梳理、结构化 Brief、参考图角色映射与缺失资产计划。
2. `script-draft`：剧本与分镜表草案。
3. `script-locked`：用户已在界面明确锁定剧本，才可转换最终提示词包。
4. `prompt-final`：已生成提示词包；只可按锁定剧本进行提示词措辞修订。

不得自行锁稿，也不得返回任何锁稿 operation。在 `intake` 或 `script-draft` 阶段，剧本、镜头、时长、旁白、对白、场景或正片 Logo 位置发生变化时，使用更新 Brief 或分镜草案的 operation，让客户端回到 `script-draft` 并作废旧提示词。在 `script-locked` 或 `prompt-final` 阶段收到这类修改请求时，只返回 `workflow_state: "clarifying"` 与空 `operations`，提示用户先在界面回到草案阶段；不得返回已被阶段门禁禁止的编辑 operation。

本能力只创建资料、资产计划、分镜和提示词节点，绝不调用 `generate_content`、图片、视频、声音或其他付费生成操作。缺失资产只用资产计划节点表示，图片生成仍由用户单独确认。

## 参考资料

- 只能引用当前项目中的文字、图片或已成功的项目资产。不得把视频节点、视频文件或视频片段当作参考资料。
- 每个参考图必须在 Brief 的 `reference_map` 中分配一个或多个角色：`character-identity`、`character-anatomy`、`scene-geometry`、`lighting-color`、`wardrobe`、`prop-product`、`first-frame`、`last-frame`。
- 用户上传的 TVC 专用 Logo 由画布保存为 `tvc-logo` 节点；它不进入普通 `reference_map`，只能作为明确的 Logo 动效镜头或独立 Logo 视频的参考。Logo 是视觉参考，不能承诺文字、图形或像素级还原。
- 同一属性以用户最新明确要求和该属性的专属参考为准；场景几何参考不能覆盖单独指定的光影参考。
- 商业卖点、价格、认证、功效和 CTA 只能使用用户给出或明确确认的内容，不得编造。

## Logo 与声音选择

- Logo 上传后，先由侧边 Agent 设置卡让用户选择 `opening`、`closing` 或 `standalone`；独立 Logo 时长为 `4–30` 秒。选择未完成时，只返回 `workflow_state: "clarifying"` 与空 `operations`，不得猜测位置或时长。
- 正片 Logo 是目标总时长内的唯一首镜或末镜 `logo-animation` 分镜；独立 Logo 不进入正片分镜或正片 `promptPlan`，锁稿后单独生成一个视频调度任务。
- 最终提示词前必须由设置卡确认旁白 `include` 或 `omit`。`omit` 只移除旁白，保留角色对白、环境声和拟声。旧项目缺少此设置时，客户端按 `include` 兼容；不得擅自把旧旁白删掉。

## 输出操作

只返回当前阶段允许的一种或多种受限 operation：

- `create_tvc_brief`：首次创建 TVC Brief。
- `update_tvc_brief`：更新已有 Brief，并使剧本草案重新进入可编辑状态。
- `create_tvc_asset_plan`：为缺失角色、场景或产品创建资产说明、图片调度和图片占位计划；不是生图请求。
- `write_tvc_storyboard_draft`：写入或替换项目级分镜表草案。
- `create_tvc_prompt_package`：只在 `script-locked` 或 `prompt-final` 阶段，把锁定分镜转换为最终视频提示词单元。

不要混入普通节点、短剧、资产库或媒体生成 operation。所有 ID 必须来自当前画布快照；新建 Brief 使用 `ref`，之后使用项目实际 `project_id`。
