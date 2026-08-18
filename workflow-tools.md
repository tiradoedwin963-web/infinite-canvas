# 画布 Agent 短剧工作流 Tool 手册

本手册只在当前画布类型为 `workflow` 时使用。

## 工作流原则

- 完整剧本默认必须先按《剧本分析与资产库 Tool 手册》建立项目资产，不得在首轮直接使用 `create_story_workflow`。
- 新分镜只在分析节点选择 `storyboardMode: comic` 且全部资产结果成功后创建，并同时遵守《公共镜头能力手册》和《漫剧分镜专项手册》。`storyboardMode: tvc` 当前待开发，不得创建工作流。
- 创建工作流不会发起付费生成，不需要用户确认。新短剧只追加到已有内容右侧，不删除或覆盖已有节点。
- 新漫剧使用分阶段导演操作，最终每镜只创建分镜文本、视频调度和视频占位；视频直接连接当镜人物、场景和关键道具资产，不创建分镜图片。旧 `create_story_workflow` 仅用于读取和运行已有五节点项目。
- 本工具只规划并生成逐镜视频片段，不声称能够拼接、配音、加字幕或导出最终成片。
- 用户没有指定时使用 `16:9`、`seedance-2.0` 和视频 `720p`；普通镜头 10 至 15 秒，允许有明确原因的 5 至 9 秒短镜头。
- 视频调度器直接连接该镜头真实出镜的人物、场景和关键道具成功资产，输入顺序固定为“主要人物 → 次要人物 → 场景 → 关键道具”。
- 每镜必须从当前资产库引用 1 至 5 个真实出镜的成功结果节点，图片顺序和筛选规则以公共镜头及当前专项手册为准。
- 如果角色涉及受保护 IP 或特定商业版本，`global_context` 可保留剧本管理信息，但 `image_prompt` 和 `video_prompt` 不得出现角色、品牌、工作室或版本名称，必须改用具体原创外观与动作特征，并直接继续执行，不得为原创近似方案再次询问用户。不指向具体商业版本的公版角色保持原写法。
- 每个 `image_prompt` 和 `video_prompt` 必须自包含生成所需信息；分镜原文只用于画布查看，不会额外拼接到模型请求。

## 旧版五节点工作流兼容

`create_story_workflow` 只用于兼容没有漫剧导演阶段元数据的旧项目。新漫剧不得返回该操作，必须按当前阶段手册依次使用四个 `create_manga_*` 操作。旧项目每批最多 8 个分镜，`chunk_index` 从 0 递增，并在最后一批填写 `is_final: true`。

```json
{
  "type": "create_story_workflow",
  "ref": "story-1",
  "title": "短剧名称",
  "global_context": "角色、场景和统一视觉设定",
  "image_model": "gemini-3-pro-image-preview",
  "video_model": "seedance-2.0",
  "aspect_ratio": "16:9",
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
