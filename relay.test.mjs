import test from "node:test";
import assert from "node:assert/strict";
import { xtreamRelay } from "./relay.mjs";

test("two viewers of the same live channel share one upstream connection", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = {
    base: process.env.XTREAM_BASE_URL,
    user: process.env.XTREAM_USERNAME,
    pass: process.env.XTREAM_PASSWORD
  };
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  process.env.XTREAM_BASE_URL = "https://provider.example";
  process.env.XTREAM_USERNAME = "test-user";
  process.env.XTREAM_PASSWORD = "test-pass";
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream({
      async start(controller) {
        await gate;
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      }
    }), { status: 200, headers: { "Content-Type": "video/mp2t" } });
  };

  try {
    const first = await xtreamRelay(new URL("https://maxplay.example/api/xtream/relay/live/77"), "live", "77");
    const second = await xtreamRelay(new URL("https://maxplay.example/api/xtream/relay/live/77"), "live", "77");
    assert.equal(calls, 1);
    const readFirst = first.arrayBuffer();
    const readSecond = second.arrayBuffer();
    release();
    const [a, b] = await Promise.all([readFirst, readSecond]);
    assert.deepEqual([...new Uint8Array(a)], [1, 2, 3, 4]);
    assert.deepEqual([...new Uint8Array(b)], [1, 2, 3, 4]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.base === undefined) delete process.env.XTREAM_BASE_URL; else process.env.XTREAM_BASE_URL = oldEnv.base;
    if (oldEnv.user === undefined) delete process.env.XTREAM_USERNAME; else process.env.XTREAM_USERNAME = oldEnv.user;
    if (oldEnv.pass === undefined) delete process.env.XTREAM_PASSWORD; else process.env.XTREAM_PASSWORD = oldEnv.pass;
  }
});
