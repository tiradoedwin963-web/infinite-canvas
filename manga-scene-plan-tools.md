# 漫剧场面调度阶段

只返回 `create_manga_scene_plans`。每个场景说明人物站位、朝向、视线、移动路线、人物距离、道具关系、空间轴线、进出画方向、光源和冷暖关系，并覆盖全部剧情节拍。

```json
{
  "type": "create_manga_scene_plans",
  "story_id": "实际短剧ID",
  "stage_index": 1,
  "plans": [{
    "scene_id": "场景assetRef",
    "beat_ids": ["beat-001"],
    "spatial_layout": "空间结构和人物初始位置",
    "blocking": "站位、走位、距离和道具关系",
    "eyeline": "人物视线对应",
    "axis": "空间轴线与允许机位侧",
    "entrances_exits": "进出画方向",
    "lighting": "主光来源、方向、软硬、反差和轮廓光",
    "color_tone": "冷暖关系和人物背景亮度关系"
  }]
}
```
