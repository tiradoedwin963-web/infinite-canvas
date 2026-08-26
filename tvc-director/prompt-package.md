# TVC 锁稿后提示词转换规则

只在 `script-locked` 或 `prompt-final` 阶段使用。严格转换锁定的 Brief、分镜表和画布快照提供的 `promptPlan`；不得在此阶段重写故事、镜头、时长、动作、旁白、声音、切点或结尾。若用户要求修改这些内容，返回合法的澄清 JSON：`workflow_state` 为 `clarifying`、`operations` 为空数组，并说明需先由用户在界面回到草案阶段；不得在锁稿阶段返回 `update_tvc_brief` 或 `write_tvc_storyboard_draft`。

`promptPlan` 是唯一权威的 30 秒视频段计划。它已按完整镜头边界切分为连续的 `4–30` 秒片段。不得按 Brief 的旧单段时长再次拆分，不得合并、删除、重排、重命名或修改其中任何片段，也不得在镜头中间切分。每个计划片段必须恰好对应 `units` 中的一项，按同一顺序复制：`ref`、`start_second`、`end_second`、`shot_numbers`、`reference_node_ids`；只填写该项的 `prompt`。若快照没有 `promptPlan`，返回 `clarifying` 与空 `operations`，提示用户先在界面按 30 秒重建视频段计划；不得从旧提示词包自行推断边界。

每条最终提示词都直接进入同一条视频调度器。项目级时间码仍用于分镜表；提示词必须以当前片段本地时间轴开始，例如计划为全片 `30–54` 秒时，提示词首个可见时间码必须是 `【00:00–00:24】`，只描述这 24 秒内的镜头、HARD CUT、动作接切、相似形状、遮挡切、对白、旁白、环境声和拟声。不要要求模型跳到本视频片段外的画面。

每次必须只返回一个完整 Agent JSON 对象，不要返回裸 operation、Markdown 或对象外文字。当前画布快照会提供“当前项目修订号”“当前锁稿修订号”和 `promptPlan`；只有两项修订号均为整数且相等、且计划存在时，才可创建提示词包。`source_revision` 必须精确填写当前锁稿修订号，绝不猜测或复用示例数字。

使用唯一的 `create_tvc_prompt_package` operation：

```json
{
  "progress_summary": "已按已持久化的 30 秒片段计划写入 2 个最终提示词单元。",
  "message": "已基于锁定分镜写入最终提示词包。",
  "workflow_state": "active",
  "operations": [{
    "type": "create_tvc_prompt_package",
    "project_id": "当前项目实际 ID",
    "source_revision": 7,
    "units": [{
      "ref": "plan-01",
      "start_second": 0,
      "end_second": 24,
      "shot_numbers": ["001", "002", "003", "004"],
      "reference_node_ids": ["当前项目实际成功资产节点 ID"],
      "prompt": "【00:00–00:24】只生成当前视频片段内的批准镜头。按本段的完整镜头边界依次描述画面、HARD CUT、动作、对白、旁白与声音。"
    }]
  }]
}
```

示例中的 `7` 只表示“从当前画布快照复制的锁稿修订号”，不是固定值；`units` 中全部非 `prompt` 字段必须逐项从 `promptPlan` 原样复制。

最终提示词可以包含 HARD CUT、动作接切、相似形状、遮挡切、对白、旁白、环境声和拟声；不得包含 J-cut、L-cut 或跨片段声音提前/延续。默认不生成 BGM、字幕、片名、Logo 或水印，必要的用户确认产品文字可保留。该 operation 只保存提示词包，绝不提交媒体生成请求。
