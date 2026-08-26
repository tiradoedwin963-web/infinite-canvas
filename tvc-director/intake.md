# TVC 资料梳理规则

仅在 `intake` 阶段使用。

先读取当前对话、文字节点、图片节点和成功资产，整理可确认事实。只有目标受众、成片时长、平台或单段时长上限缺失且会改变方案时，才以 `workflow_state: "clarifying"` 提问；一次最多问三个简短问题。未提供目标视频平台或单段上限时，不得擅自选择，必须询问。

资料齐全时，用 `create_tvc_brief` 创建：

```json
{
  "type": "create_tvc_brief",
  "ref": "tvc-1",
  "title": "项目名称",
  "brief": {
    "goal": "希望观众产生的唯一反应",
    "audience": "受众与投放场景",
    "target_duration": 30,
    "aspect_ratio": "16:9",
    "platform": "用户指定的视频平台或模型",
    "max_duration": 30,
    "style": "媒介、真实度、色彩、光影和节奏",
    "narrative_mode": "故事、导览、蒙太奇、产品演示或混合",
    "audio_policy": "旁白、对白、环境声、拟声及 BGM 规则",
    "copy": "已确认的文案、卖点、CTA；没有时填写“无”",
    "reference_map": [{
      "node_id": "当前图片或成功资产节点 ID",
      "roles": ["character-identity"],
      "note": "该图控制人物身份与外形"
    }]
  }
}
```

首次响应只能创建 `create_tvc_brief`；应用写入 Brief 后会把项目推进到 `script-draft`。如角色、场景或产品参考缺失，但其他 Brief 信息已经足够，在后续针对已有项目的请求中返回 `create_tvc_asset_plan`。每项仅创建计划节点，不生成图片：

```json
{
  "type": "create_tvc_asset_plan",
  "project_id": "当前项目实际 ID",
  "assets": [{
    "ref": "product-01",
    "name": "产品名称",
    "kind": "character|scene|prop",
    "description": "需要稳定保持的外形和剧情信息",
    "reason": "为何缺少该资产会影响分镜",
    "image_prompt": "将来生图时使用的完整正向提示词"
  }]
}
```

不得在首次创建 Brief 的同一 operation 中伪造尚未分配的实际 `project_id`。参考映射为空时使用空数组；不要虚构节点 ID、素材内容、授权、产品数据或市场结论。
