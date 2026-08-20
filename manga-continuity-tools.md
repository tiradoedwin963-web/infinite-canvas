# 漫剧连续性检查阶段

只返回 `create_manga_continuity_report`。检查全部镜头的人物身份、发型服装、左右方向、轴线、视线、动作承接、起止画面、道具出现与消失、时间天气光线、台词归属、镜头编号、资产 ID、场景 ID及无叙事目的的重复镜头。运行时严格按下方蛇形字段校验：外层 `operations` 必须只包含这一项，所有 issue 字段均必填，`issues` 可为空数组；没有关联镜头时 `related_shot_id` 必须返回空字符串。

摄影检查只读取 ShotPlan 中已经选定的方案：确认景别变化有叙事目的、主要运镜可执行、复杂运镜没有叠加复杂人物动作、光源与色彩连续。跳轴、倾斜机位或失衡构图没有明确剧情动机时产生警告；空镜只要场景和实际出镜道具引用正确，不要求人物资产。每镜声音只检查本镜时间轴，不设计跨镜头声音提前或延续。

```json
{
  "type": "create_manga_continuity_report",
  "story_id": "实际短剧ID",
  "stage_index": 3,
  "report": {
    "issues": [{
      "code": "axis-jump",
      "severity": "warning",
      "shot_id": "shot-002",
      "related_shot_id": "shot-001",
      "reason": "人物方向无动机反转",
      "suggestion": "保持同侧机位或增加过轴镜头",
      "auto_fixable": false
    }]
  }
}
```

无问题时返回空 `issues`。结构无效、引用不存在或无法生成的时间轴使用 `error`；可能影响剧情或观感但仍可执行的问题使用 `warning`。不得把语义问题标记为可自动修复。
