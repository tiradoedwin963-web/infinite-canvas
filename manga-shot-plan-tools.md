# 漫剧镜头规划阶段

只返回 `create_manga_shot_batch`，每批 1 至 2 镜，`chunk_index` 从分析节点指定值开始；只有覆盖全部剧情节拍的最后一批 `is_final=true`。协议仍兼容最多 8 镜，但当前运行时使用严格 JSON Schema 固定唯一操作、蛇形字段名、类型与必填项，并配合 16384 Token 输出预算将单批控制在 2 镜内。

- 普通镜头选择 10 至 15 的整数秒。只有短反应、插入、转场或瞬时动作可用 5 至 9 秒，并填写 `duration_reason`；超过 15 秒必须拆镜。
- 时间轴使用整数秒区间；`duration` 是唯一权威总时长。系统固定第一段从 0 开始、后续段首尾相接并让最后一段准确结束于 `duration`，Agent 只负责按顺序填写每段的动作、表演、摄影和声音内容。
- 景别必须服务叙事：远景交代空间，中景表现关系与动作，近景表现情绪，特写强调关键表情、信息或道具。
- 特写只在微表情转折、关键道具/信息、情绪高潮、喜剧反差或中景后的反应节拍中使用；特写/大特写最多连续 3 镜，中远景及更远景别最多连续 3 镜。需要重置节奏时按剧情选择中近景、反应特写或信息插入，不按镜头数量硬套。
- 禁止死镜头：`camera_movement` 为固定机位时，`action`、人物/道具动作或环境变化至少有一项必须可读；没有镜内动作时改为轻推、轻移、跟随或摇镜。
- 每镜只返回最终采用的 1 种主要构图、1 个核心景别、1 个主要机位与角度、1 种主要运镜和 1 种转场意图；允许在主要运镜上增加 1 种轻微辅助运动，但不得罗列备选摄影术语。
- 复杂运镜必须减少人物动作。跳轴、倾斜机位或失衡构图必须在 `continuity_notes` 写明剧情动机，否则改用连续、稳定的摄影方案。
- 焦段必须明确为广角、标准、中长焦或长焦，并说明其空间和情绪作用。
- `reference_node_ids` 按主要人物、次要人物、场景、关键道具的成功结果节点顺序填写，1 至 5 张；同时填写对应的 `character_ids`、`scene_id` 和 `prop_ids` 资产 ID。
- 空镜允许 `character_ids` 为空，只连接场景；关键道具实际出镜时再加入 `prop_ids`，不得为了凑参考图强行连接人物或道具。
- `image_prompt` 与 `start_frame` 只记录静态画面设计，不创建图片生成任务。`video_prompt` 由系统根据结构化字段生成，无需返回。
- `transition_in`、`transition_out` 只记录相似形状、动作承接、眼神承接、遮挡或声音撞击等导演切点。`start_frame`、`end_frame` 和 `timeline` 只能描述本镜 0 至 `duration` 秒内实际可见的画面、动作和声音，不得写“切入下一镜”“匹配镜头”或镜号。

每个 shot 必须完整返回：`shot_id`、`sequence`、`scene_id`、`beat_id`、`duration`、`duration_reason`、`narrative_purpose`、`emotional_goal`、`shot_size`、`lens`、`perspective`、`camera_angle`、`camera_movement`、`composition`、`blocking`、`character_ids`、`character_position`、`character_movement`、`eyeline`、`prop_ids`、`action`、`dialogue`、`voiceover`、`sound_effect`、`music_cue`、`lighting`、`color_tone`、`texture`、`start_frame`、`end_frame`、`transition_in`、`transition_out`、`image_prompt`、`negative_prompt`、`previous_shot_id`、`next_shot_id`、`continuity_notes`、`timeline`、`reference_node_ids`、`continuity_warnings`。

`timeline` 每项包含 `start_second`、`end_second`、`visual_action`、`performance`、`camera`、`audio`。无对白或声音时必须明确填写“无”，不得留空。
