import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the infinite canvas with the LingkeAI composer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>LingkeAI 无限画布<\/title>/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /aria-label="LingkeAI 无限画布"/);
  assert.match(html, /class="infinite-canvas"/);
  assert.match(html, /aria-label="AI 创作输入"/);
  assert.match(html, /aria-label="添加参考图"/);
  assert.match(html, />文本节点<\/option>/);
  assert.match(html, />GPT-5\.6 Sol<\/option>/);
  assert.match(html, />Claude Sonnet 5<\/option>/);
  assert.match(html, /aria-label="生成"/);
  assert.match(html, /aria-label="打开画布 Agent"/);
  assert.doesNotMatch(html, /codex-preview|Building your site/i);
});

test("loads the creation, workflow, and asset tool manuals through the agent route", async () => {
  const [route, agentInstructions, manual, workflowManual, assetManual] = await Promise.all([
    readFile(new URL("../app/api/ai/agent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../agent.md", import.meta.url), "utf8"),
    readFile(new URL("../tools.md", import.meta.url), "utf8"),
    readFile(new URL("../workflow-tools.md", import.meta.url), "utf8"),
    readFile(new URL("../story-asset-tools.md", import.meta.url), "utf8"),
  ]);
  assert.match(route, /tools\.md\?raw/);
  assert.match(route, /workflow-tools\.md\?raw/);
  assert.match(route, /story-asset-tools\.md\?raw/);
  assert.match(route, /toolManual/);
  assert.match(route, /workflowToolManual/);
  assert.match(route, /storyAssetToolManual/);
  assert.match(agentInstructions, /progress_summary/);
  assert.match(agentInstructions, /不得输出逐步推理、隐含思维链/);
  assert.match(manual, /gemini-3-pro-image-preview/);
  assert.match(manual, /gpt-image-2/);
  assert.doesNotMatch(manual, /gpt-5\.6-sol|doubao-seedance/);
  assert.match(workflowManual, /create_story_workflow/);
  assert.match(workflowManual, /run_story_workflow/);
  assert.match(assetManual, /create_story_analysis/);
  assert.match(assetManual, /create_story_asset_batch/);
  assert.match(assetManual, /run_story_assets/);
  assert.match(assetManual, /visual_style/);
  assert.match(assetManual, /foundation_role/);
  assert.match(assetManual, /图1为主角结果，图2为核心配角结果/);
  assert.match(agentInstructions, /角色 IP 风险/);
  assert.match(agentInstructions, /不得为“是否改成原创近似方案”再次询问用户/);
  assert.match(agentInstructions, /必须同时去掉商业版本名称和该公版角色名称/);
  assert.match(manual, /特定商业版本/);
  assert.match(assetManual, /`visual_style` 同样不得出现角色、品牌、工作室或版本名称/);
  assert.match(workflowManual, /分镜原文只用于画布查看/);
  assert.match(assetManual, /资产说明节点只用于画布管理/);
});

test("streams sanitized agent progress and keeps operations behind the final result", async () => {
  const [route, provider, sidebar, stream] = await Promise.all([
    readFile(new URL("../app/api/ai/agent/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ai/agent-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/canvas-agent-sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ai/agent-stream.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /request\.signal/);
  assert.match(route, /send\("progress"/);
  assert.match(route, /send\("activity"/);
  assert.match(route, /AGENT_ACTIVITY_EVENT_INTERVAL_MS = 5_000/);
  assert.match(route, /send\("result"/);
  assert.match(provider, /stream: true/);
  assert.doesNotMatch(provider, /slice\(0, 12_000\)/);
  assert.match(stream, /extractProgressSummary/);
  assert.match(stream, /item\.event === "result"/);
  assert.match(sidebar, /readAgentSseResponse/);
  assert.match(sidebar, /处理摘要：/);
  assert.match(sidebar, /确认基础角色并继续/);
  assert.match(sidebar, /awaiting-foundation-approval/);
  assert.match(sidebar, /已等待/);
  assert.match(sidebar, /runAgentRequestWithTimeout/);
});

test("removes the disposable starter surface", async () => {
  const [page, graph, packageJson, composer, agentSidebar, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/canvas/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../components/ui/ai-chat-input.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/canvas-agent-sidebar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
  const canvasNodeRule = styles.match(/\.canvas-node \{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/);
  assert.match(page, /<AIChatInput[\s\S]*?onSubmit=\{submitGeneration\}/);
  assert.match(page, /lockedMode=\{selectedManualNode\?\.kind\}/);
  assert.match(page, /aria-label=\{side === "left" \? "添加上游节点" : "添加下游节点"\}/);
  assert.match(page, /className="canvas-edge-draft"/);
  assert.match(page, /<CanvasNodeHandles/);
  assert.match(page, /<CanvasNodeResizeHandles/);
  assert.match(page, /<NodeDetailDialog/);
  assert.match(page, /const restoreAssetUrl = useCallback/);
  assert.match(page, /const previousUrl = current\[assetId\]/);
  assert.match(page, /URL\.revokeObjectURL\(previousUrl\)/);
  assert.match(page, /loadedAssets\.current\.add\(id\)/);
  assert.match(page, /loadedAssetIds\.clear\(\)/);
  assert.match(page, /recoveringAssetIds\.clear\(\)/);
  assert.match(page, /assetRecoveryAttempts\.current\.has\(assetId\)/);
  assert.ok((page.match(/onError=\{onAssetError\}/g) ?? []).length >= 2);
  assert.match(page, /图片素材已失效，请重新上传。/);
  assert.match(page, /onDoubleClick=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?onOpen\(\);/);
  assert.match(page, /node\.kind !== "text" && !mediaUrl/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-label="节点文本内容"/);
  assert.match(page, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(page, /updateOutputNode\(current, detailNodeId, \{ text: detailTextDraft \}\)/);
  assert.match(page, /<video[\s\S]*?controls[\s\S]*?preload="metadata"/);
  assert.doesNotMatch(page, /<video[\s\S]*?autoPlay/);
  assert.match(page, /connectionActive=\{connectionDraft\?\.nodeId === node\.id\}/);
  assert.match(page, /canvas-node-connection-active/);
  assert.match(page, /visible=\{Boolean\(connectionDraft\) \|\| revealedNodeId === node\.id\}/);
  assert.match(page, /canvas-node-handles-visible/);
  assert.match(page, /onPointerLeave=\{onPointerLeave\}/);
  assert.match(page, /<CanvasNodeAddMenu/);
  assert.match(page, /addNodeMenuAnchor\.x \+ addNodeMenuAnchorSize\.width \+ 52/);
  assert.match(page, /addNodeMenuAnchorSize\.height \/ 2 - 60/);
  assert.match(page, /style=\{\{ transform: `translate\(\$\{x\}px, \$\{y\}px\)` \}\}/);
  assert.match(page, /document[\s\S]*?\.elementFromPoint/);
  assert.match(page, /\[data-connection-node-id\]\[data-connection-side\]/);
  assert.match(page, /data-connection-node-id=\{node\.id\}/);
  assert.match(page, /data-connection-side=\{side\}/);
  assert.match(page, /buildManualNodeContext/);
  assert.match(page, /imageNodeToFile/);
  assert.match(
    page,
    /fitMediaNode\(\s*current,\s*nodeId,\s*naturalWidth,\s*naturalHeight,?\s*\)/,
  );
  assert.match(page, /resizedNodeBounds/);
  assert.match(page, /resizeNode\(value, current\.nodeId, nextBounds\)/);
  assert.match(page, /d=\{draftEdgePath\([\s\S]*?connectionDraft\.point/);
  assert.doesNotMatch(page, /draftTargetNode/);
  assert.match(page, /edge\.sourceSide,[\s\S]*?edge\.targetSide/);
  assert.match(page, /className="canvas-edge-hit"/);
  assert.match(page, /aria-label="删除连线"/);
  assert.match(page, /event\.key !== "Delete" && event\.key !== "Backspace"/);
  assert.match(page, /contenteditable='true'/);
  assert.match(page, /event\.currentTarget\.naturalWidth/);
  assert.match(page, /event\.currentTarget\.videoWidth/);
  assert.match(page, /width: nodeSize\.width/);
  assert.match(page, /height: nodeSize\.height/);
  assert.equal((page.match(/resolution: submission\.resolution/g) ?? []).length, 2);
  assert.match(page, /node\.role === "output" \|\| node\.manual/);
  assert.match(page, /<CanvasAgentSidebar/);
  assert.match(page, /hidden={isAgentOpen}/);
  assert.match(page, /aria-label="打开画布 Agent"/);
  assert.match(page, /!event\.ctrlKey[\s\S]*?panViewport\(current, -deltaX, -deltaY\)/);
  assert.match(page, /wheelZoomFactor\(deltaY, true\)/);
  assert.match(page, /target\.closest\("\[data-node-id\], \.canvas-selection-frame"\)/);
  assert.match(page, /addEventListener\("wheel", handleCanvasWheel, \{ passive: false \}\)/);
  assert.match(page, /nodesIntersectingBounds/);
  assert.match(page, /validSelectedNodeIds\.length > 1[\s\S]*?selectedNodesBounds\(graph, validSelectedNodeIds\)/);
  assert.match(page, /className="canvas-selection-frame"/);
  assert.match(page, /className="canvas-selection-marquee"/);
  assert.match(page, /moveNodes\(graphValue, current\.nodeIds, deltaX, deltaY\)/);
  assert.doesNotMatch(page.match(/<main[\s\S]*?>/)?.[0] ?? "", /onWheel=\{/);
  assert.match(page, /canvas-node-image-only/);
  assert.match(styles, /\.canvas-node-image-only \{[\s\S]*?border: 0;/);
  assert.match(styles, /\.canvas-node-image-content \{[\s\S]*?object-fit: contain;/);
  assert.match(styles, /\.canvas-node-detail-backdrop \{[\s\S]*?position: fixed;[\s\S]*?z-index: 60;/);
  assert.match(styles, /\.canvas-node-detail-media \{[\s\S]*?object-fit: contain;/);
  assert.match(styles, /\.canvas-node-image-error,[\s\S]*?\.canvas-node-detail-media-error \{/);
  assert.match(styles, /\.canvas-node \{[\s\S]*?overflow: visible;/);
  assert.doesNotMatch(canvasNodeRule, /backdrop-filter:/);
  assert.match(styles, /\.canvas-node-handle \{[\s\S]*?opacity: 0;/);
  assert.match(styles, /\.canvas-node-handle-layer \{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.canvas-node-handle::before \{[\s\S]*?inset: -14px;/);
  assert.match(
    styles,
    /\.canvas-node-handles-visible \.canvas-node-handle,[\s\S]*?\.canvas-node-connection-active \.canvas-node-handle,[\s\S]*?\.canvas-node-handle:focus-visible \{[\s\S]*?opacity: 1;/,
  );
  assert.match(styles, /\.canvas-node-handle-left \{[\s\S]*?left: -42px;/);
  assert.match(styles, /\.canvas-node-handle-right \{[\s\S]*?right: -42px;/);
  assert.match(styles, /\.canvas-node-resize-layer \{/);
  assert.match(
    styles,
    /\.canvas-node-resize-handle \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;[\s\S]*?background: transparent;[\s\S]*?pointer-events: auto;/,
  );
  assert.match(
    styles,
    /\.canvas-node-resize-handle::after \{[\s\S]*?width: 8px;[\s\S]*?height: 8px;[\s\S]*?opacity: 0;/,
  );
  assert.match(
    styles,
    /\.canvas-node-resize-handle:hover::after,[\s\S]*?\.canvas-node-resize-handle:active::after \{[\s\S]*?opacity: 1;/,
  );
  assert.doesNotMatch(styles, /\.canvas-node-resize-layer::before/);
  assert.doesNotMatch(styles, /\.canvas-node-selected/);
  assert.doesNotMatch(page, /canvas-node-selected|resizingNodeId|canvas-node-resize-visible/);
  assert.match(styles, /\.canvas-node-delete \{[\s\S]*?z-index: 18;/);
  assert.match(styles, /\.canvas-node-resize-north-west \{[\s\S]*?cursor: nwse-resize;/);
  assert.match(
    styles,
    /\.canvas-node-resize-north-east \{[\s\S]*?top: -16px;[\s\S]*?right: -16px;/,
  );
  assert.match(styles, /\.canvas-node-resize-south-east \{[\s\S]*?cursor: nwse-resize;/);
  assert.match(styles, /\.canvas-selection-frame \{[\s\S]*?border-style: dashed;[\s\S]*?pointer-events: auto;/);
  assert.match(styles, /\.canvas-selection-marquee \{[\s\S]*?pointer-events: none;/);
  assert.match(styles, /\.canvas-node-add-menu \{/);
  assert.match(styles, /\.canvas-edge-selected \{/);
  assert.match(styles, /\.canvas-edge-hit \{[\s\S]*?pointer-events: stroke;/);
  assert.match(styles, /\.canvas-edge-delete \{/);
  assert.match(styles, /\.canvas-node-handle-target \{/);
  assert.match(graph, /export function connectNodes/);
  assert.match(graph, /export function removeEdge/);
  assert.match(graph, /sourceSide: edge\.sourceSide \?\? "right"/);
  assert.match(graph, /targetSide: edge\.targetSide \?\? "left"/);
  assert.match(graph, /sourceId === targetId/);
  assert.match(graph, /graph\.edges\.some\(/);
  assert.match(graph, /export function createConnectedNode/);
  assert.match(graph, /export function buildManualNodeContext/);
  assert.match(graph, /width\?: number/);
  assert.match(graph, /height\?: number/);
  assert.match(graph, /export function getNodeSize/);
  assert.match(graph, /export function resizeNode/);
  assert.match(graph, /export function fitMediaNode/);
  assert.match(graph, /export function nodesIntersectingBounds/);
  assert.match(graph, /export function selectedNodesBounds/);
  assert.match(graph, /export function moveNodes/);
  assert.match(
    composer,
    /MODEL_CONFIGS\[mode\]/,
  );
  assert.match(composer, /DEFAULT_MODEL_BY_MODE\[nextMode\]/);
  assert.match(composer, /resolution\?: string/);
  assert.match(composer, /function initialResolution/);
  assert.match(composer, /defaultResolution \?\? ""/);
  assert.match(composer, /selectedModel\.resolutions\.includes\(resolution\)/);
  assert.match(composer, /aria-label="分辨率"/);
  assert.match(composer, /selectedModel\.resolutions\.map/);
  assert.match(composer, /mode === "text" \? undefined : resolution \|\| undefined/);
  assert.match(composer, /lockedMode\?: ComposerMode/);
  assert.match(composer, /hidden\?: boolean/);
  assert.match(composer, /y: hidden \? "calc\(100% \+ 24px\)" : 0/);
  assert.match(composer, /disabled=\{Boolean\(lockedMode\)\}/);
  assert.match(composer, /initial=\{\{ height: 54 \}\}/);
  assert.match(composer, /w-\[614px\] max-w-full/);
  assert.match(composer, /102 \+ \(images\.length > 0 \? 51 : 0\)/);
  assert.match(composer, /hasVisibleError \? 19 : 0/);
  assert.match(
    composer,
    /const isExpanded = isActive \|\| Boolean\(inputValue\) \|\| images\.length > 0/,
  );
  assert.match(composer, /if \(isExpanded\) return/);
  assert.doesNotMatch(composer, /!inputValue && isExpanded/);
  assert.match(composer, /showPlaceholder && !isExpanded && !inputValue/);
  assert.match(composer, /flex h-full flex-col justify-end/);
  assert.match(composer, /\{ height: 0, opacity: 0, y: 16 \}/);
  assert.match(composer, /absolute bottom-\[9px\] left-2\.5/);
  assert.match(composer, /absolute right-2\.5 bottom-\[9px\]/);
  assert.match(
    composer,
    /items-center px-5 \$\{\s*isExpanded \? "h-\[48px\]" : "h-\[54px\]"/,
  );
  assert.match(composer, /isExpanded \? "px-0" : "px-\[31px\]"/);
  assert.match(composer, /right-\[31px\] left-\[31px\]/);
  assert.match(
    composer,
    /h-\[54px\] min-w-0 shrink-0 items-center px-\[51px\]/,
  );
  assert.match(composer, /h-\[51px\] shrink-0 items-center gap-1\.5 overflow-x-auto px-5/);
  assert.match(composer, /h-\[19px\][^\n]*px-5/);
  assert.match(composer, /group relative h-11 w-11/);
  assert.ok(
    composer.indexOf("flex h-[51px] shrink-0 items-center") <
      composer.indexOf('isExpanded ? "h-[48px]" : "h-[54px]"'),
  );
  assert.ok(
    composer.indexOf('isExpanded ? "h-[48px]" : "h-[54px]"') <
      composer.indexOf("h-[54px] min-w-0 shrink-0 items-center"),
  );
  assert.match(composer, /px-5 pb-5/);
  assert.match(composer, /type="file"/);
  assert.match(composer, /staggerChildren:\s*0\.025/);
  assert.match(composer, /\.split\(""\)/);
  assert.doesNotMatch(composer, /\bfetch\s*\(|axios/);
  assert.match(agentSidebar, /aria-label="画布 Agent"/);
  assert.match(agentSidebar, /w-\[320px\] max-w-full/);
  assert.match(agentSidebar, /max-\[480px\]:w-full/);
  assert.match(page, /src="\/agent-icon\.png"/);
  assert.match(agentSidebar, /src="\/agent-icon\.png"/);
  assert.match(agentSidebar, /AGENT_CHAT_STORAGE_KEY/);
  assert.match(agentSidebar, /AGENT_CONVERSATIONS_STORAGE_KEY/);
  assert.match(agentSidebar, /aria-label="Agent 历史对话"/);
  assert.match(agentSidebar, /aria-label="新建 Agent 对话"/);
  assert.match(agentSidebar, /Agent 历史对话列表/);
  assert.match(agentSidebar, /isDangerousAgentOperation/);
  assert.match(agentSidebar, /正在读取画布并处理/);
  assert.match(agentSidebar, /全部确认（\{pendingConfirmations\.length\}）/);
  assert.match(agentSidebar, /runAgentConfirmationWithTimeout/);
  assert.match(agentSidebar, /确认内容已失效/);
  assert.match(agentSidebar, /data-workflow-isolated/);
  assert.match(agentSidebar, /overflow-y-auto overscroll-y-contain/);
  assert.match(page, /signal: AbortSignal/);
  assert.match(page, /fetch\(node\.resultUrl, \{ signal \}\)/);
  assert.match(page, /createGenerationNodes\(\s*graphRef\.current,/);
  assert.match(page, /graphRef\.current = created\.graph/);
});

test("exposes an isolated workflow mode without the bottom composer", async () => {
  const [page, workflow, workflowGraph, styles, viteConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/workflow/workflow-canvas.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/workflow/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CanvasExperienceMode = "creation" \| "workflow"/);
  assert.match(page, /lingke-canvas-experience-mode/);
  assert.match(page, /\s创作\s*<\/button>/);
  assert.match(page, /\s工作流\s*<\/button>/);
  assert.match(page, /experienceMode === "creation" \? <CreationCanvas \/> : <WorkflowCanvas \/>/);
  assert.doesNotMatch(workflow, /<AIChatInput/);
  assert.match(workflow, /onDoubleClick=\{handleCanvasDoubleClick\}/);
  assert.match(workflow, /双击画布，创建素材节点或调度节点/);
  assert.match(workflow, /运行 \$\{taskCount\} 个任务/);
  assert.match(workflow, /created\.resultIds\.map\(async \(resultId\)/);
  assert.match(workflow, /当前模型不支持视频参考输入/);
  assert.match(workflow, /startClientX: event\.clientX/);
  assert.match(workflow, /Math\.hypot\([\s\S]*?\) >= 6/);
  assert.match(workflow, /connection\?\.moved && connectionSource/);
  assert.match(workflow, /<WorkflowSchedulerMenu/);
  assert.match(workflow, /createConnectedScheduler/);
  assert.match(workflow, /文本生成/);
  assert.match(workflow, /图片生成/);
  assert.match(workflow, /视频生成/);
  assert.match(workflow, /<CanvasAgentSidebar/);
  assert.match(workflow, /workflowProjectConversationKey/);
  assert.match(workflow, /workflow-project-switcher/);
  assert.match(workflow, /createWorkflowProject/);
  assert.match(workflow, /renameWorkflowProject/);
  assert.match(workflow, /removeWorkflowProject/);
  assert.match(workflow, /describeWorkflowRun/);
  assert.match(workflow, /advanceWorkflowBatch/);
  assert.match(workflow, /提交状态未知/);
  assert.match(workflow, /aria-label="打开工作流 Agent"/);
  assert.match(workflow, /先分析类型、主题、受众、情绪和时长/);
  assert.match(workflow, /粘贴完整剧本或输入资产规划要求/);
  assert.match(workflow, /生成选中资产/);
  assert.match(workflow, /createStoryAssetBatchRun/);
  assert.match(workflow, /markStoryAssetPlanning/);
  assert.match(workflow, /fitWorkflowImageNode/);
  assert.match(workflow, /createWorkflowViewportController/);
  assert.match(workflow, /workflowGridTransform/);
  assert.match(workflow, /className="workflow-grid"/);
  assert.match(workflow, /world\.style\.transform/);
  assert.match(workflow, /controller\.pan\(-deltaX, -deltaY\)/);
  assert.match(workflow, /controller\.zoom\(anchor, wheelZoomFactor\(deltaY, true\)\)/);
  assert.doesNotMatch(workflow, /setViewport\(\(current\)/);
  assert.doesNotMatch(workflow, /style\.setProperty\("--canvas-/);
  assert.match(workflow, /createWorkflowGraphPersistence/);
  assert.match(workflow, /createWorkflowRafBatcher/);
  assert.match(workflow, /workflowInputPorts\(graph\)/);
  assert.match(workflow, /workflowEdgeKinds\(graph\)/);
  assert.match(workflow, /workflowPendingInputPoint\(graph, connectionTarget\.id\)/);
  assert.match(workflow, /className="canvas-edge-hit"/);
  assert.match(workflow, /setHoveredEdgeId\(edge\.id\)/);
  assert.match(workflow, /data-workflow-edge-delete/);
  assert.match(workflow, /removeWorkflowEdge\(current, hoveredEdge\.id\)/);
  assert.match(workflow, /port\.label/);
  assert.match(workflow, /port\.sourceName/);
  assert.match(workflow, /workflow-input-section/);
  assert.match(workflow, /workflow-input-row-\$\{port\.kind\}/);
  assert.match(workflow, /workflow-input-row-\$\{pendingInputKind\}/);
  assert.doesNotMatch(workflow, /workflow-input-layer/);
  assert.match(workflow, /resizeRenderRef\.current\.schedule\(update\)/);
  assert.match(workflow, /marqueeRenderRef\.current\.schedule\(next\)/);
  assert.match(workflow, /connectionRenderRef\.current\.schedule\(next\)/);
  assert.match(workflow, /persistenceRef\.current\?\.schedule\(graph\)/);
  assert.match(workflow, /const WorkflowNodeCard = memo/);
  assert.match(workflow, /const WorkflowNodeOverlay = memo/);
  assert.match(workflow, /const edgePaths = useMemo/);
  assert.match(workflow, /isAgentOpen[\s\S]*?createWorkflowAgentSnapshot/);
  assert.match(workflow, /event\.currentTarget\.naturalWidth/);
  assert.match(workflow, /decoding="async"/);
  assert.match(workflow, /workflow-source-body-media/);
  assert.match(workflowGraph, /lingke-workflow-canvas-v1/);
  assert.match(workflowGraph, /export function createStoryWorkflow/);
  assert.match(workflowGraph, /export function fitWorkflowImageNode/);
  assert.match(workflowGraph, /export function createConnectedScheduler/);
  assert.match(styles, /\.canvas-mode-switch \{/);
  assert.match(styles, /\.workflow-project-switcher \{/);
  assert.match(styles, /\.workflow-scheduler \{/);
  assert.match(styles, /\.workflow-source-body-media \{/);
  assert.match(styles, /\.workflow-node-title \{/);
  const baseEdgeRule = styles.match(/\.canvas-edges path\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(baseEdgeRule, /stroke-width: 2;/);
  const workflowEdgeRule = styles.match(/\.workflow-canvas \.canvas-edges \.canvas-edge,[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";
  assert.match(workflowEdgeRule, /stroke-width: 4;/);
  assert.match(styles, /\.workflow-canvas \.canvas-edges \.canvas-edge-image \{[\s\S]*?stroke: #5063b9;/);
  assert.match(styles, /\.workflow-canvas \.canvas-edges \.canvas-edge-image\.canvas-edge-hovered \{[\s\S]*?stroke: #3f50a0;/);
  assert.match(styles, /\.workflow-input-row-image \{/);
  assert.match(styles, /\.workflow-input-row::before \{[\s\S]*?height: 4px;/);
  assert.match(styles, /\.workflow-scheduler-fields \{[\s\S]*?overflow-y: auto;/);
  assert.doesNotMatch(styles, /\.workflow-input-layer \{/);
  const selectionRunRule = styles.match(/\.workflow-selection-run\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(selectionRunRule, /z-index: 22;/);
  assert.match(selectionRunRule, /pointer-events: auto;/);
  assert.match(styles, /\.workflow-canvas \{[\s\S]*?background-image: none;/);
  assert.match(styles, /\.workflow-grid \{[\s\S]*?contain: strict;/);
  assert.match(styles, /data-workflow-viewport-active[\s\S]*?will-change: transform;/);
  assert.match(styles, /\.workflow-node \{[\s\S]*?content-visibility: auto;/);
  assert.match(viteConfig, /port: 3001/);
  assert.match(viteConfig, /strictPort: true/);
});
