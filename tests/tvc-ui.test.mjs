import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offers an isolated TVC project flow with explicit lock and storyboard export", async () => {
  const [canvas, sidebar, styles, projectsRoute] = await Promise.all([
    readFile(new URL("../components/workflow/workflow-canvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/canvas-agent-sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/projects/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(canvas, /项目类型/);
  assert.match(canvas, /TVC 导演/);
  assert.match(canvas, /createWorkflowProjectGraph\([\s\S]*?projectEditor\.projectMode/);
  assert.match(canvas, /createCloudProject\([\s\S]*?projectEditor\.projectMode/);
  assert.match(canvas, /TVC 项目暂不接收视频参考/);
  assert.match(canvas, /TVC 视频任务由锁稿后的最终提示词自动建立/);
  assert.match(canvas, /syncTvcVideoWorkflow\(graph\)/);
  assert.match(canvas, /tvcVideoSchedulerRunError\(graphRef\.current, scheduler\)/);
  assert.match(canvas, /isRunnableTvcVideoScheduler\(graph, node\)/);
  assert.match(canvas, /markTvcVideoSchedulerManualOverride/);
  assert.match(canvas, /TVC 最终提示词调度器固定输出视频，可调整其余视频参数/);
  assert.match(canvas, /TVC 仅允许锁稿后的最终提示词视频调度器提交任务/);
  assert.match(canvas, /已手动覆盖：可编辑参数、提示词和图片参考资产/);
  assert.match(canvas, /历史版本：锁稿已更新，仅保留查看/);
  assert.match(canvas, /outputKindLocked=\{tvcVideoTask\}/);
  assert.doesNotMatch(canvas, /locked=\{tvcVideoTask\}/);
  assert.match(canvas, /onRemoveTvcImageInput/);
  assert.match(canvas, /onMoveTvcImageInput/);
  assert.match(canvas, /TVC 视频仅可添加本项目已成功生成的图片资产作为参考图/);
  assert.match(canvas, /最终提示词文本连线保留；仅可移除参考媒体资产/);
  assert.match(canvas, /submission-unknown/);
  assert.match(canvas, /确认重新提交/);
  assert.match(canvas, /视频提交连接中断，无法确认媒体平台是否已接收请求/);
  assert.match(canvas, /persistMediaSubmissionGraph/);
  assert.match(canvas, /不能通过删除绕过重提确认/);
  assert.match(canvas, /TRX_SEEDANCE_25_MODEL/);
  assert.match(canvas, /const usesTrxCloudReferences = scheduler\.outputKind === "video"/);
  assert.match(canvas, /SD 2\.5 视频仅支持云端项目的已归档图片资产/);
  assert.match(canvas, /projectId: activeProjectIdRef\.current/);
  assert.match(canvas, /referenceAssetIds/);
  assert.match(canvas, /: \{ images \}/);
  const runSlice = canvas.slice(
    canvas.indexOf("const runScheduler"),
    canvas.indexOf("useEffect(() => {\n    if (!hydrated || !batchRun"),
  );
  assert.ok(
    runSlice.indexOf("await persistMediaSubmissionGraph(created.graph)") <
      runSlice.indexOf('fetch("/api/ai/generate"'),
    "the pending submission state must save before a media request starts",
  );
  const schedulerControls = canvas.slice(
    canvas.indexOf("function SchedulerControls"),
    canvas.indexOf("function ResultBody"),
  );
  assert.match(schedulerControls, /输出类型<select disabled=\{outputKindLocked/);
  assert.match(schedulerControls, /模型<select disabled=\{tvcVideoHistorical\} value=\{node\.model\}/);
  assert.match(schedulerControls, /提示词<textarea readOnly=\{tvcVideoHistorical\} value=\{node\.prompt\}/);
  assert.match(schedulerControls, /比例<select disabled=\{tvcVideoHistorical\} value=\{node\.aspectRatio\}/);
  assert.match(schedulerControls, /清晰度<select disabled=\{tvcVideoHistorical\} value=\{node\.resolution\}/);
  assert.match(schedulerControls, /时长<select disabled=\{tvcVideoHistorical\} value=\{node\.duration\}/);
  assert.match(schedulerControls, /数量<select disabled=\{tvcVideoHistorical \|\| node\.assetRole === "scheduler"\}/);
  assert.doesNotMatch(schedulerControls, /readOnly=\{locked\}|disabled=\{locked/);
  assert.match(canvas, /disabled=\{running \|\| !canRun\}/);
  assert.match(canvas, /按30秒重新输出/);
  assert.match(canvas, /调整镜头段/);
  assert.match(canvas, /prepareTvcPromptPlan\(graphRef\.current\)/);
  assert.match(canvas, /saveTvcPromptPlanBoundaries\(graphRef\.current, boundaries\)/);
  assert.match(canvas, /保存镜头段并重新输出/);
  assert.match(canvas, /项目时间/);
  assert.match(canvas, /实际时长/);
  assert.match(canvas, /包含镜头/);
  assert.match(canvas, /在镜头 \$\{timed\.row\.shotNumber\} 后切段/);
  assert.match(canvas, /videoSchedulers\.map\(\(scheduler\)/);
  assert.match(canvas, /textOnly: true/);
  assert.match(canvas, /onAutoRequestComplete=\{completeTvcPromptRegeneration\}/);
  assert.match(sidebar, /autoRequest\?: CanvasAgentAutoRequest/);
  assert.match(sidebar, /自动重建最终提示词只能使用已锁定的文字分镜，不能读取图片/);
  assert.match(sidebar, /textOnly: autoRequest\.textOnly/);
  const autoRequestSlice = canvas.slice(
    canvas.indexOf("const queueTvcPromptRegeneration"),
    canvas.indexOf("const runScheduler"),
  );
  assert.doesNotMatch(autoRequestSlice, /\/api\/ai\/generate/);
  const prepareSlice = canvas.slice(
    canvas.indexOf("const prepareTvc30SecondPromptPlan"),
    canvas.indexOf("const saveTvcPromptPlan"),
  );
  const saveSegmentSlice = canvas.slice(
    canvas.indexOf("const saveTvcPromptPlan"),
    canvas.indexOf("const completeTvcPromptRegeneration"),
  );
  assert.doesNotMatch(prepareSlice, /queueTvcPromptRegeneration/);
  assert.match(saveSegmentSlice, /queueTvcPromptRegeneration\(saved\.graph\)/);
  assert.match(canvas, /锁定 TVC 分镜稿/);
  assert.match(canvas, /确认锁稿/);
  assert.match(canvas, /lockTvcScript\(current\)/);
  assert.match(canvas, /查看 TVC 分镜表/);
  assert.match(canvas, /导出 Excel/);
  assert.match(canvas, /createTvcStoryboardWorkbook/);
  assert.match(canvas, /TvcStoryboardCanvasPanel/);
  assert.match(canvas, /画布内分镜表/);
  assert.match(canvas, /saveTvcStoryboardTableDraft/);
  assert.match(styles, /\.workflow-project-mode \{/);
  assert.match(styles, /\.tvc-storyboard-canvas-panel \{/);
  assert.match(styles, /\.tvc-prompt-plan-editor \{/);
  assert.match(styles, /\.tvc-prompt-plan-rows label \{/);
  assert.match(styles, /\.workflow-input-row-actions \{/);
  assert.match(styles, /\.workflow-tvc-video-status \{/);
  assert.match(styles, /\.workflow-submission-unknown \{/);
  assert.match(styles, /\.workflow-submission-confirm \{/);
  assert.match(projectsRoute, /projectMode/);
  assert.match(projectsRoute, /createWorkflowProjectGraph\("tvc", \(\) => id\)/);
});
