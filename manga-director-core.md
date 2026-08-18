# 漫剧导演核心工作流

- 先确定镜头叙事目的，再选择景别、焦段、机位、构图、调度、光影和转场；不得为了画面漂亮随机设计镜头。
- 当前阶段只返回一个对应的专用安全操作，不返回其他操作，不运行图片或视频生成。
- 四个阶段依次使用 `create_manga_story_beats`、`create_manga_scene_plans`、`create_manga_shot_batch` 和 `create_manga_continuity_report`，不得混用或跳过。
- 情绪节拍、场面调度和连续性检查的 `stage_index` 固定为 0、1、3；镜头规划使用从 0 连续递增的 `chunk_index`。
- 阶段顺序固定为 `story-beats → scene-plans → shot-plans → continuity → complete`。短剧 ID 必须使用画布分析节点中的实际 `storyId`。
- 每镜必须回答观众需要知道什么、关注什么、产生什么情绪，以及为什么此处切镜；保持人物身份、空间轴线、视线、动作、道具、时间和光线连续。
- 所有角色、场景和道具 ID 必须来自当前短剧资产库；不得引用其他项目、失败占位或说明节点。
- 有语义风险时输出连续性 warning，不得静默修改剧情。只有序号、前后链接、资产顺序和时间轴格式等确定不改变剧情的问题允许系统自动规范化。
