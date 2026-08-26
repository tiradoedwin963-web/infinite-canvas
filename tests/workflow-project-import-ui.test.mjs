import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("imports embedded image projects locally or into a fresh cloud project without media work", async () => {
  const [canvas, styles] = await Promise.all([
    readFile(new URL("../components/workflow/workflow-canvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(canvas, /importWorkflowProject\(projects, await file\.text\(\)\)/);
  assert.match(canvas, /accept="\.canvas\.json,application\/json"/);
  assert.match(canvas, /aria-label=\{remote \? "导入本地项目到云端" : "导入本地项目"\}/);
  assert.match(canvas, /runningSchedulersRef\.current\.size/);
  assert.match(canvas, /for \(const asset of imported\.assets\)/);
  assert.match(canvas, /imageBlobFromDataUrl\(asset\.dataUrl, asset\.mimeType\)/);
  assert.match(canvas, /await saveAsset\(asset\.id, blob\)/);
  assert.match(canvas, /workflowProjectGraphKey\(imported\.project\.id\)/);
  assert.match(canvas, /workflowProjectConversationKey\(imported\.project\.id\)/);
  assert.match(canvas, /activeProjectIdRef\.current = imported\.project\.id/);
  assert.match(canvas, /图片未包含在文件中，请在对应节点重新上传/);
  assert.match(canvas, /prepareWorkflowProjectExport\(graphRef\.current, readAsset\)/);
  assert.match(canvas, /dataUrl: await blobToDataUrl\(file\)/);
  assert.match(canvas, /async function prepareWorkflowProjectExport/);
  assert.match(canvas, /const exportGraph: WorkflowGraph = \{/);
  assert.match(canvas, /node\.status !== "success"/);
  assert.match(canvas, /!node\.resultUrl/);
  assert.match(canvas, /export-result-\$\{node\.id\}/);
  assert.match(canvas, /生成图片“\$\{node\.label \|\| node\.id\}”无法完整导出/);
  assert.match(canvas, /graph: exported\.graph/);
  assert.match(canvas, /assets: exported\.assets/);
  assert.match(canvas, /createCloudProject\(/);
  assert.match(canvas, /uploadCloudAsset\(\{/);
  assert.match(canvas, /rebindImportedWorkflowAssets\(imported\.graph, uploadedAssets\)/);
  assert.match(canvas, /await saveCloudProject\(\{/);
  assert.match(canvas, /await saveCloudConversation\(\{/);
  assert.match(canvas, /await deleteCloudProject\(createdProjectId\)\.catch/);
  assert.doesNotMatch(canvas, /云端项目暂不支持从本地导入/);
  assert.match(canvas, /workflow-project-import-error/);
  assert.match(styles, /\.workflow-project-import-error \{/);
});
