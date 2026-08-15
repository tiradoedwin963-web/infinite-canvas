import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashPassword, verifyPassword } from "../app/server/password.ts";
import { requestOrigin } from "../app/server/request-origin.ts";
import { safeUpstreamUrl, workflowObjectKey } from "../app/server/storage-rules.ts";
import { parseWorkflowGraph } from "../app/workflow/graph.ts";

test("password hashes use scrypt and reject the wrong password", async () => {
  const encoded = await hashPassword("temporary-password");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(await verifyPassword("temporary-password", encoded), true);
  assert.equal(await verifyPassword("different-password", encoded), false);
});

test("workflow object keys are isolated by user and project", () => {
  assert.equal(
    workflowObjectKey("user-a", "project-b", "asset-c"),
    "users/user-a/projects/project-b/assets/asset-c",
  );
});

test("generated result asset metadata remains compatible with workflow v1", () => {
  const graph = parseWorkflowGraph(JSON.stringify({
    version: 1,
    nodes: [{
      id: "result-1",
      x: 0,
      y: 0,
      type: "result",
      kind: "image",
      schedulerId: "scheduler-1",
      text: "",
      model: "test",
      status: "success",
      progress: "",
      error: "",
      assetId: "asset-1",
      assetName: "frame.png",
      assetMimeType: "image/png",
    }],
    edges: [],
  }));
  assert.equal(graph.version, 1);
  assert.equal(graph.nodes[0].assetId, "asset-1");
});

test("generated result ingestion rejects local and non-HTTPS URLs", () => {
  assert.throws(() => safeUpstreamUrl("http://example.com/a.png"));
  assert.throws(() => safeUpstreamUrl("https://127.0.0.1/a.png"));
  assert.throws(() => safeUpstreamUrl("https://localhost/a.png"));
  assert.equal(safeUpstreamUrl("https://cdn.example.com/a.png").hostname, "cdn.example.com");
});

test("same-origin checks honor the public origin forwarded by the trusted proxy", () => {
  const proxied = new Request("http://app:3000/api/auth/login", {
    headers: {
      origin: "https://82.157.204.208:3011",
      "x-forwarded-host": "82.157.204.208:3011",
      "x-forwarded-proto": "https",
    },
  });
  const invalidProxy = new Request("http://app:3000/api/auth/login", {
    headers: {
      "x-forwarded-host": "82.157.204.208:3011",
      "x-forwarded-proto": "javascript",
    },
  });
  assert.equal(requestOrigin(proxied), "https://82.157.204.208:3011");
  assert.equal(requestOrigin(invalidProxy), "http://app:3000");
});

test("cloud routes enforce ownership, revisions, private cookies and isolated Postgres", async () => {
  const [projectRoute, assetRoute, auth, compose] = await Promise.all([
    readFile(new URL("../app/api/workflow/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/assets/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../deploy/canvas/compose.production.yml", import.meta.url), "utf8"),
  ]);
  assert.match(projectRoute, /owner_id = \$\{user\.id\}/);
  assert.match(projectRoute, /revision = \$\{Number\(input\.revision\)\}/);
  assert.match(assetRoute, /owner_id = \$\{user\.id\}/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(compose, /postgres:17-alpine/);
  assert.doesNotMatch(compose, /5432:5432/);
  assert.match(compose, /WORKFLOW_STORAGE_MODE: server/);
});
