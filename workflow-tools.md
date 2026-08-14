# 画布 Agent 短剧工作流 Tool 手册

本手册只在当前画布类型为 `workflow` 时使用。

## 工作流原则

- 完整剧本默认必须先按《剧本分析与资产库 Tool 手册》建立项目资产，不得在首轮直接使用 `create_story_workflow`。本手册保留用于兼容已有分镜规划流程。
- 创建工作流不会发起付费生成，不需要用户确认。新短剧只追加到已有内容右侧，不删除或覆盖已有节点。
- 每个分镜必须包含分镜文本、图片调度、图片占位、视频调度和视频占位。图片占位必须预先连接到视频调度，作为视频的唯一图片资产。
- 本工具只规划并生成逐镜视频片段，不声称能够拼接、配音、加字幕或导出最终成片。
- 用户没有指定时使用 `9:16`、`gemini-3-pro-image-preview`、图片 `1K`、`doubao-seedance-1-5-pro-251215`、视频 `720p`、每镜 `5` 秒；连续动作确需更长时使用 `10` 秒。
- 分镜应按视觉动作切分，一个分镜只表达一个主要画面和一个连续动作。保持角色外观、服装、场景方位、光线和色彩连续。
- 图片提示词描述可作为首帧的静态关键画面；视频提示词描述动作、表情、镜头运动、节奏和禁止变化项，不重复伪造参考图片。
- 现有图片素材只写入用户明确指定的分镜 `reference_node_ids`，不得自动扩散到其他分镜。

## 创建短剧工作流

每批最多 8 个分镜。长剧本用相同 `ref`、标题、全局设定和模型参数连续返回多批，`chunk_index` 从 0 递增；只有最后一批填写 `is_final: true`。不得重复分镜 `ref`。

```json
{
  "type": "create_story_workflow",
  "ref": "story-1",
  "title": "短剧名称",
  "global_context": "角色、场景和统一视觉设定",
  "image_model": "gemini-3-pro-image-preview",
  "video_model": "doubao-seedance-1-5-pro-251215",
  "aspect_ratio": "9:16",
  "image_resolution": "1K",
  "video_resolution": "720p",
  "chunk_index": 0,
  "is_final": true,
  "shots": [{
    "ref": "shot-01",
    "title": "镜头标题",
    "script": "对应剧本、动作和对白",
    "image_prompt": "主体、环境、景别构图、光线、风格、连续性约束和排除项",
    "video_prompt": "动作、表情、镜头运动、节奏和禁止变化项",
    "duration": "5",
    "reference_node_ids": []
  }]
}
```

不得在创建短剧工作流的同一响应（同一轮）返回 `run_story_workflow`。先创建并让用户检查；用户明确要求全部生成或指定分镜批量生成后，才能请求批量运行。

## 批量运行

`run_story_workflow` 会产生模型费用，必须等待客户端确认。`shot_refs` 为空表示整部短剧；非空表示只运行指定分镜。同层所有就绪任务会并行提交；单个分镜失败只停止该分镜的下游。

```json
{
  "type": "run_story_workflow",
  "story_id": "画布快照中的实际短剧 ID",
  "shot_refs": []
}
```

不得使用尚未创建的 `ref` 代替实际 `story_id`，不得声称未确认的批量生成已经执行。用户也可以直接点击每个调度节点的运行按钮逐个生成。
