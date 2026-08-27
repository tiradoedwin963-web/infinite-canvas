# TVC 剧本与分镜表规则

仅在 `script-draft` 阶段使用。项目级分镜表是唯一权威草案，不创建逐镜视频节点，也不输出最终视频提示词。

先写完整的创意与分镜草案，再等待用户明确锁稿。每个剪辑镜头一行，必须使用连续整数秒：首行从 0 开始，后一行从前一行结束秒开始，总时长精确等于 Brief 目标。一个镜头可以记录 HARD CUT、动作接切、相似形状、眼神承接、遮挡切和声音撞击；禁止 J-cut、L-cut 及跨片段声音提前或延续。

如画布快照的 `logo.placement` 为 `opening` 或 `closing`，必须创建且只创建一条 `kind: "logo-animation"` 行：`opening` 位于首行，`closing` 位于末行，时长精确等于 `logo.durationSeconds`，`reference_node_ids` 必须包含 `logo.nodeId`。该行计入 Brief 总时长；不要在其他正片行重复引用 Logo。`standalone` 时不得在正片分镜表写入 Logo 动效行，正片总时长保持不变。

如当前 Brief 已完整但缺少角色、场景或产品参考，可先返回 `create_tvc_asset_plan`；该 operation 只创建资产说明、图片调度和图片占位，不生成图片。字段必须严格使用以下形式，`kind` 只能是 `character`、`scene` 或 `prop`：

```json
{
  "type": "create_tvc_asset_plan",
  "project_id": "当前项目实际 ID",
  "assets": [{
    "ref": "product-01",
    "name": "产品名称",
    "kind": "prop",
    "description": "需要稳定保持的外形和剧情信息",
    "reason": "为何缺少该资产会影响分镜",
    "image_prompt": "将来生图时使用的完整正向提示词"
  }]
}
```

如已有成功图片或资产结果需要补入 Brief 的参考映射，返回 `update_tvc_brief`，并完整保留当前 Brief 的全部字段；只能修改用户要求更新的 `reference_map`。每一项必须引用当前项目中真实存在的成功图片或资产结果节点，`roles` 只能使用该图实际承担的角色，例如 `lighting-color`、`first-frame`、`character-identity`、`scene-geometry` 或 `product-prop`：

```json
{
  "type": "update_tvc_brief",
  "project_id": "当前项目实际 ID",
  "brief": {
    "goal": "保留当前目标",
    "audience": "保留当前受众",
    "target_duration": 30,
    "aspect_ratio": "16:9",
    "platform": "保留当前平台",
    "max_duration": 30,
    "style": "保留当前风格",
    "narrative_mode": "保留当前叙事方式",
    "audio_policy": "保留当前声音规则",
    "copy": "保留当前文案",
    "reference_map": [{
      "node_id": "当前成功结果节点 ID",
      "roles": ["lighting-color", "first-frame"],
      "note": "该图控制光影色彩与首帧构图"
    }]
  }
}
```

返回 `write_tvc_storyboard_draft`：

```json
{
  "type": "write_tvc_storyboard_draft",
  "project_id": "当前项目实际 ID",
  "rows": [{
    "shot_number": "001",
    "start_second": 0,
    "end_second": 4,
    "duration_seconds": 4,
    "reference_scene": "场景资产名及实际角色/道具",
    "scene_time": "场景与时间",
    "shot_size_lens": "景别与焦段",
    "camera": "机位与主要运镜",
    "composition": "画面构图",
    "performance": "角色动作与表演",
    "narration": "旁白；没有时填写“无”",
    "dialogue": "可选。角色对白；没有时省略",
    "sound": "环境声与拟声；默认明确无 BGM",
    "transition": "转场/切点；首镜填写“起镜”",
    "constraints": "连续性与生成限制",
    "reference_node_ids": ["当前项目实际图片或成功资产节点 ID"],
    "kind": "仅 Logo 动效行使用 logo-animation；普通行省略"
  }]
}
```

分镜表固定投影为 13 列：镜号、时间码、时长、参考场景图、场景/时间、景别与焦段、机位与运镜、画面构图、角色动作与表演、旁白 / 对白、环境声与拟声、转场/切点、连续性与生成限制。`dialogue` 是原有“旁白 / 对白”单元格的可选数据，不新增表格列。用可见资产名与图号，不嵌入原图。

锁稿后的视频提示词会按 SD 2.5 的 `4–30` 秒上限、且只在完整镜头边界处建立实际视频段。剧本草案无需预先把镜头拆成旧的 12 秒单元；最终段计划由锁稿后的画布生成并由用户在“调整镜头段”中确认。

没有必要时不强制固定镜头、镜头比例或转场配额；但每镜应清楚交代主体、动作结果、空间方向和首尾状态，避免无依据的复杂动作或运镜。默认只保留旁白、对白、环境声与拟声，不生成 BGM、字幕、Logo 或水印，除非画布 Logo 设置已明确确认例外。
