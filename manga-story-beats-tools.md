# 漫剧情绪节拍阶段

只返回 `create_manga_story_beats`。按场景、剧情转折、对白目标和情绪变化拆分；每个节拍必须能对应至少一个镜头。运行时严格按下方蛇形字段校验：外层 `operations` 必须只包含这一项，所有示例字段均必填。

```json
{
  "type": "create_manga_story_beats",
  "story_id": "实际短剧ID",
  "stage_index": 0,
  "beats": [{
    "beat_id": "beat-001",
    "sequence": 1,
    "scene_id": "当前项目的场景assetRef",
    "narrative_purpose": "观众此刻需要知道的信息",
    "emotional_goal": "观众应产生的情绪",
    "summary": "剧情动作、对白目标和转折"
  }]
}
```

`beat_id` 和 `sequence` 必须唯一连续；`scene_id` 必须是真实场景资产 ID。
