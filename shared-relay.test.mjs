import test from "node:test";
import assert from "node:assert/strict";
import { SharedStreamRelay } from "./shared-relay.mjs";

test("two viewers with the same key share one upstream connection", async () => {
  let upstreamCalls = 0;
  let source;
  const relay = new SharedStreamRelay({
    fetcher: async () => {
      upstreamCalls++;
      return new Response(new ReadableStream({
        start(controller) { source = controller; }
      }));
    }
  });

  const first = relay.open("live:42", "https://provider.invalid/live/42.ts");
  const second = relay.open("live:42", "https://provider.invalid/live/42.ts");
  const firstReader = first.body.getReader();
  const secondReader = second.body.getReader();

  for (let i = 0; i < 20 && !source; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(source, "upstream stream should start");
  assert.equal(upstreamCalls, 1);

  const chunk = new Uint8Array([0x47, 0x01, 0x02]);
  source.enqueue(chunk);
  const [a, b] = await Promise.all([firstReader.read(), secondReader.read()]);
  assert.deepEqual([...a.value], [...chunk]);
  assert.deepEqual([...b.value], [...chunk]);
  assert.equal(upstreamCalls, 1);

  await Promise.all([firstReader.cancel(), secondReader.cancel()]);
});

test("relay enforces its configured viewer limit", async () => {
  const relay = new SharedStreamRelay({ maxViewers: 1, fetcher: async () => new Response(new ReadableStream()) });
  const first = relay.open("live:7", "https://provider.invalid/live/7.ts");
  const second = relay.open("live:7", "https://provider.invalid/live/7.ts");
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  await first.body.cancel();
});
