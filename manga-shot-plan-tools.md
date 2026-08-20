# 漫剧镜头规划阶段

只返回 `create_manga_shot_batch`，每批 1 至 2 镜，`chunk_index` 从分析节点指定值开始；只有覆盖全部剧情节拍的最后一批 `is_final=true`。协议仍兼容最多 8 镜，但当前运行时使用严格 JSON Schema 固定唯一操作、蛇形字段名、类型与核心必填项，并配合 16384 Token 输出预算将单批控制在 2 镜内。续批指令会给出本批唯一允许的 `shot_id / sequence` 对：一镜只能使用第一对，两镜必须按给定顺序使用两对，不得复用、跳号或改写既有镜头。

- 当前项目的节奏由分析节点锁定，不得自行混用：新漫剧默认`影视剪辑`，每行可选择 2 至 5 秒短镜或 6 至 15 秒长镜；`长镜直出`中普通镜头选择 10 至 15 的整数秒，短反应、插入、转场或瞬时动作可用 5 至 9 秒并填写 `duration_reason`；`短片剪辑`中每行分镜严格选择 2 或 3 秒。没有额外时长理由时 `duration_reason` 填“无”。
- `影视剪辑`和短片剪辑的每行只定义剪辑时间码和镜内内容；连续镜头可跨场景合并为 4 至 30 秒的 Seedance 2.5 视频片段。每个短镜仍必须写完整的首尾状态、时间轴、切点和资产引用。
- 时间轴使用整数秒区间；`duration` 是唯一权威总时长。系统固定第一段从 0 开始、后续段首尾相接并让最后一段准确结束于 `duration`，Agent 只负责按顺序填写每段的动作、表演、摄影和声音内容。
- 景别必须服务叙事：远景交代空间，中景表现关系与动作，近景表现情绪，特写强调关键表情、信息或道具。
- 特写优先用于微表情转折、关键道具/信息、情绪高潮、喜剧反差或中景后的反应节拍；景别重复、固定机位和复杂运镜均可按剧情使用。若出现视觉节奏单一、无可读动作或复杂度过高，会在全局摄影检查中提出建议，不会阻止镜头节点创建。
- 每镜只返回最终采用的 1 种主要构图、1 个核心景别、1 个主要机位与角度、1 种主要运镜和 1 种转场意图；允许在主要运镜上增加 1 种轻微辅助运动，但不得罗列备选摄影术语。
- 复杂运镜应减少人物动作。跳轴、倾斜机位或失衡构图可在 `continuity_notes` 写明剧情动机，供连续性检查提示人工确认。
- 焦段必须明确为广角、标准、中长焦或长焦，并说明其空间和情绪作用。
- `reference_node_ids` 按主要人物、次要人物、场景、关键道具的成功结果节点顺序填写，1 至 5 张；同时填写对应的 `character_ids`、`scene_id` 和 `prop_ids` 资产 ID。
- 空镜允许 `character_ids` 为空，只连接场景；关键道具实际出镜时再加入 `prop_ids`，不得为了凑参考图强行连接人物或道具。
- `image_prompt` 与 `start_frame` 只记录静态画面设计，不创建图片生成任务。`video_prompt` 由系统根据结构化字段生成，无需返回。
- `transition_in`、`transition_out` 可直接记录 HARD CUT、匹配切、动作接切、眼神承接、遮挡切、黑场或声音撞击等导演切点。`start_frame`、`end_frame` 和 `timeline` 仍描述本镜 0 至 `duration` 秒内实际可见的画面、动作和声音；影视剪辑视频片段会按这些切点在片段内部明确执行切换。

每个 shot 必须返回核心字段：`shot_id`、`sequence`、`scene_id`、`beat_id`、`duration`、`duration_reason`、`narrative_purpose`、`emotional_goal`、`shot_size`、`lens`、`perspective`、`camera_angle`、`camera_movement`、`composition`、`blocking`、`character_ids`、`character_position`、`character_movement`、`eyeline`、`prop_ids`、`action`、`dialogue`、`voiceover`、`sound_effect`、`music_cue`、`lighting`、`color_tone`、`texture`、`start_frame`、`end_frame`、`transition_in`、`transition_out`、`image_prompt`、`negative_prompt`、`continuity_notes`、`timeline`、`reference_node_ids`。不要输出 `video_prompt`、前后镜 ID 或 Schema 外字段。

上述文本字段均进入严格输出 Schema；没有内容时填写“无”。`previous_shot_id`、`next_shot_id` 和 `continuity_warnings` 不进入 Schema，由系统按顺序或检查结果填充。`timeline` 每项返回 `start_second`、`end_second`、`visual_action`、`performance`、`camera`、`audio`，没有表演或声音时填写“无”。
