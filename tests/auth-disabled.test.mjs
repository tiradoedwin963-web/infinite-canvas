import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canvasAdminUsername,
  canvasAuthenticationDisabled,
} from "../app/server/config.ts";

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("application authentication only disables with the explicit production gate", () => {
  withEnvironment({
    WORKFLOW_STORAGE_MODE: "server",
    CANVAS_AUTH_DISABLED: "true",
    CANVAS_ADMIN_USERNAME: "  fixed-admin  ",
  }, () => {
    assert.equal(canvasAuthenticationDisabled(), true);
    assert.equal(canvasAdminUsername(), "fixed-admin");
  });
  withEnvironment({
    WORKFLOW_STORAGE_MODE: "server",
    CANVAS_AUTH_DISABLED: "1",
  }, () => {
    assert.equal(canvasAuthenticationDisabled(), false);
  });
  withEnvironment({
    WORKFLOW_STORAGE_MODE: "local",
    CANVAS_AUTH_DISABLED: "true",
  }, () => {
    assert.equal(canvasAuthenticationDisabled(), false);
  });
});

test("disabled authentication resolves the configured admin and hides account UI", async () => {
  const [auth, session, login, logout, migration, gate, compose] = await Promise.all([
    readFile(new URL("../app/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/migrate-database.mjs", import.meta.url), "utf8"),
    readFile(new URL("../components/cloud-session-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../deploy/canvas/compose.production.yml", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /if \(canvasAuthenticationDisabled\(\)\) return readConfiguredAdminUser\(\)/);
  assert.match(auth, /lower\(username\) = lower\(\$\{username\}\)/);
  assert.match(auth, /AND is_admin = true/);
  assert.match(session, /authenticationRequired: !canvasAuthenticationDisabled\(\)/);
  assert.match(login, /当前服务器已关闭应用登录/);
  assert.match(logout, /if \(canvasAuthenticationDisabled\(\)\)/);
  assert.match(gate, /mode === "server" && authenticationRequired && !user/);
  assert.match(gate, /mode === "server" && authenticationRequired && user/);
  assert.match(migration, /CANVAS_AUTH_DISABLED === "true"/);
  assert.match(migration, /requires an existing active admin user/);
  assert.match(compose, /CANVAS_AUTH_DISABLED: "true"/);
  assert.doesNotMatch(compose, /CANVAS_ADMIN_PASSWORD_HASH/);
});
