import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LingkeRequestError } from "../app/ai/provider.ts";
import {
  TRX_VIDEO_REFERENCE_URL_TTL_SECONDS,
  resolveTrxVideoReferences,
} from "../app/server/trx-video-references.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const assetOne = "33333333-3333-4333-8333-333333333333";
const assetTwo = "44444444-4444-4444-8444-444444444444";
const assetThree = "55555555-5555-4555-8555-555555555555";
const assetFour = "66666666-6666-4666-8666-666666666666";

function asset(id, objectKey, byteSize = 1024) {
  return { id, objectKey, mimeType: "image/png", byteSize };
}

function dependencies(assets, calls = { inspected: [], signed: [] }) {
  return {
    projectBelongsToUser: async (candidateProjectId, candidateUserId) => {
      assert.equal(candidateProjectId, projectId);
      assert.equal(candidateUserId, ownerId);
      return true;
    },
    findProjectAssets: async () => assets,
    inspectObject: async (key) => {
      calls.inspected.push(key);
      return {};
    },
    createReadUrl: async (input) => {
      calls.signed.push(input);
      return `https://cos.test/${input.key}?signature=hidden`;
    },
  };
}

test("signs existing ordered project assets directly without writing or deleting objects", async () => {
  const calls = { inspected: [], signed: [] };
  const output = await resolveTrxVideoReferences({
    userId: ownerId,
    projectId,
    assetIds: [assetTwo, assetOne],
  }, dependencies([
    asset(assetOne, "users/u/projects/p/assets/one"),
    asset(assetTwo, "users/u/projects/p/assets/two"),
  ], calls));

  assert.deepEqual(calls.inspected, [
    "users/u/projects/p/assets/two",
    "users/u/projects/p/assets/one",
  ]);
  assert.deepEqual(calls.signed, [
    {
      key: "users/u/projects/p/assets/two",
      expiresSeconds: TRX_VIDEO_REFERENCE_URL_TTL_SECONDS,
    },
    {
      key: "users/u/projects/p/assets/one",
      expiresSeconds: TRX_VIDEO_REFERENCE_URL_TTL_SECONDS,
    },
  ]);
  assert.deepEqual(output, [
    "https://cos.test/users/u/projects/p/assets/two?signature=hidden",
    "https://cos.test/users/u/projects/p/assets/one?signature=hidden",
  ]);
});

test("rejects unavailable, cross-project, malformed, duplicate, or oversized image references before signing", async () => {
  const available = dependencies([asset(assetOne, "users/u/projects/p/assets/one")]);
  await assert.rejects(
    resolveTrxVideoReferences({ userId: ownerId, projectId, assetIds: [assetTwo] }, available),
    /不属于当前项目或尚未可用/,
  );
  await assert.rejects(
    resolveTrxVideoReferences({ userId: ownerId, projectId, assetIds: [assetOne, assetOne] }, available),
    /编号无效/,
  );
  await assert.rejects(
    resolveTrxVideoReferences({ userId: ownerId, projectId, assetIds: ["not-a-uuid"] }, available),
    /编号无效/,
  );
  await assert.rejects(
    resolveTrxVideoReferences({
      userId: ownerId,
      projectId,
      assetIds: [assetOne],
    }, dependencies([asset(assetOne, "users/u/projects/p/assets/one", 11 * 1024 * 1024)])),
    /单张参考图不能超过 10MB/,
  );
  await assert.rejects(
    resolveTrxVideoReferences({
      userId: ownerId,
      projectId,
      assetIds: [assetOne, assetTwo, assetThree, assetFour],
    }, dependencies([
      asset(assetOne, "users/u/projects/p/assets/one", 8 * 1024 * 1024),
      asset(assetTwo, "users/u/projects/p/assets/two", 8 * 1024 * 1024),
      asset(assetThree, "users/u/projects/p/assets/three", 8 * 1024 * 1024),
      asset(assetFour, "users/u/projects/p/assets/four", 8 * 1024 * 1024),
    ])),
    /参考图总大小不能超过 30MB/,
  );
});

test("rejects a missing original object or signing failure without submitting a video", async () => {
  await assert.rejects(
    resolveTrxVideoReferences({ userId: ownerId, projectId, assetIds: [assetOne] }, {
      ...dependencies([asset(assetOne, "users/u/projects/p/assets/one")]),
      inspectObject: async () => {
        throw new Error("not found");
      },
    }),
    (error) => error instanceof LingkeRequestError && error.status === 400 && /不存在或无法读取/.test(error.message),
  );
  await assert.rejects(
    resolveTrxVideoReferences({ userId: ownerId, projectId, assetIds: [assetOne] }, {
      ...dependencies([asset(assetOne, "users/u/projects/p/assets/one")]),
      createReadUrl: async () => {
        throw new Error("storage unavailable");
      },
    }),
    (error) => error instanceof LingkeRequestError && error.status === 502 && /无法签发/.test(error.message),
  );
});

test("permits cloud text2video with no reference asset IDs after ownership verification", async () => {
  let queried = 0;
  const output = await resolveTrxVideoReferences({
    userId: ownerId,
    projectId,
    assetIds: [],
  }, {
    projectBelongsToUser: async () => true,
    findProjectAssets: async () => {
      queried += 1;
      return [];
    },
  });
  assert.deepEqual(output, []);
  assert.equal(queried, 0);
});

test("routes SD 2.5 through authenticated existing-asset signing without temporary staging", async () => {
  const route = await readFile(
    new URL("../app/api/ai/generate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /const user = await requireSessionWhenCloud\(request\)/);
  assert.match(route, /if \(!user \|\| !input\.projectId\)/);
  assert.match(route, /resolveReferenceUrls: \(\) => resolveTrxVideoReferences\(\{/);
  assert.match(route, /userId: user\.id/);
  assert.match(route, /projectId: input\.projectId!/);
  assert.match(route, /assetIds: input\.referenceAssetIds \?\? \[\]/);
  assert.doesNotMatch(route, /stageTrxVideoReferences|writeObject|deleteObject|temporary\/tvc-video-references/);
});
