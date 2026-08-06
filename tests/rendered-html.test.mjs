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
  assert.doesNotMatch(html, /codex-preview|Building your site/i);
});

test("removes the disposable starter surface", async () => {
  const [page, graph, packageJson, composer, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/canvas/graph.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../components/ui/ai-chat-input.tsx", import.meta.url),
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
  assert.match(page, /visible=\{revealedNodeId === node\.id\}/);
  assert.match(page, /canvas-node-handles-visible/);
  assert.match(page, /onPointerLeave=\{onPointerLeave\}/);
  assert.match(page, /<CanvasNodeAddMenu/);
  assert.match(page, /addNodeMenuAnchor\.x \+ addNodeMenuAnchorSize\.width \+ 52/);
  assert.match(page, /addNodeMenuAnchorSize\.height \/ 2 - 60/);
  assert.match(page, /style=\{\{ transform: `translate\(\$\{x\}px, \$\{y\}px\)` \}\}/);
  assert.match(page, /document[\s\S]*?\.elementFromPoint/);
  assert.match(page, /buildManualNodeContext/);
  assert.match(page, /imageNodeToFile/);
  assert.match(
    page,
    /fitMediaNode\(\s*current,\s*nodeId,\s*naturalWidth,\s*naturalHeight,?\s*\)/,
  );
  assert.match(page, /resizedNodeBounds/);
  assert.match(page, /resizeNode\(value, current\.nodeId, nextBounds\)/);
  assert.match(page, /event\.currentTarget\.naturalWidth/);
  assert.match(page, /event\.currentTarget\.videoWidth/);
  assert.match(page, /width: nodeSize\.width/);
  assert.match(page, /height: nodeSize\.height/);
  assert.equal((page.match(/resolution: submission\.resolution/g) ?? []).length, 2);
  assert.match(page, /node\.role === "output" \|\| node\.manual/);
  assert.doesNotMatch(page, /toolbar|sidebar|canvas-agent/i);
  assert.match(page, /event\.target !== canvas/);
  assert.match(page, /addEventListener\("wheel", handleCanvasWheel, \{ passive: false \}\)/);
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
  assert.match(styles, /\.canvas-node-resize-handle \{[\s\S]*?pointer-events: auto;/);
  assert.match(styles, /\.canvas-node-resize-visible::before,[\s\S]*?opacity: 1;/);
  assert.match(styles, /\.canvas-node-resize-north-west \{[\s\S]*?cursor: nwse-resize;/);
  assert.match(styles, /\.canvas-node-resize-south-east \{[\s\S]*?cursor: nwse-resize;/);
  assert.match(styles, /\.canvas-node-add-menu \{/);
  assert.match(styles, /\.canvas-node-connection-target \{/);
  assert.match(graph, /export function connectNodes/);
  assert.match(graph, /sourceId === targetId/);
  assert.match(graph, /graph\.edges\.some\(/);
  assert.match(graph, /export function createConnectedNode/);
  assert.match(graph, /export function buildManualNodeContext/);
  assert.match(graph, /width\?: number/);
  assert.match(graph, /height\?: number/);
  assert.match(graph, /export function getNodeSize/);
  assert.match(graph, /export function resizeNode/);
  assert.match(graph, /export function fitMediaNode/);
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
});
