import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./addon.mjs";

const env = { ...process.env };
function clearConfig() {
  delete process.env.XTREAM_BASE_URL;
  delete process.env.XTREAM_USERNAME;
  delete process.env.XTREAM_PASSWORD;
}

test("status reports Xtream as unconfigured without secrets", async () => {
  clearConfig();
  const res = await handleRequest(new Request("http://localhost/api/xtream/status"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { configured: false });
});

test("catalog endpoint fails closed when credentials are absent", async () => {
  clearConfig();
  const res = await handleRequest(new Request("http://localhost/api/xtream/live/categories"));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /não configurado/i);
});

test("playback rejects invalid IDs and unknown types", async () => {
  process.env.XTREAM_BASE_URL = "http://provider.invalid";
  process.env.XTREAM_USERNAME = "test";
  process.env.XTREAM_PASSWORD = "test";
  const badId = await handleRequest(new Request("http://localhost/api/xtream/play/live/not-an-id"));
  const badType = await handleRequest(new Request("http://localhost/api/xtream/play/unknown/123"));
  assert.equal(badId.status, 400);
  assert.equal(badType.status, 400);
});

test("proxy rejects unregistered external targets", async () => {
  process.env.XTREAM_BASE_URL = "http://provider.invalid";
  process.env.XTREAM_USERNAME = "test";
  process.env.XTREAM_PASSWORD = "test";
  const res = await handleRequest(new Request("http://localhost/api/xtream/proxy?url=https%3A%2F%2Fevil.invalid%2Fmedia.m3u8"));
  assert.equal(res.status, 404);
});

test("playback URL does not expose Xtream credentials", async () => {
  process.env.XTREAM_BASE_URL = "http://provider.invalid";
  process.env.XTREAM_USERNAME = "private-user";
  process.env.XTREAM_PASSWORD = "private-password";
  const res = await handleRequest(new Request("http://localhost/api/xtream/play/live/123"));
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.ok(body.includes("/api/xtream/relay?ref="));
  assert.ok(!body.includes("private-user"));
  assert.ok(!body.includes("private-password"));
});

test.after(() => {
  for (const k of ["XTREAM_BASE_URL", "XTREAM_USERNAME", "XTREAM_PASSWORD"]) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
});
