const relays = new Map();

function getConfig() {
  const base = String(process.env.XTREAM_BASE_URL || "").trim().replace(/\\/+$/, "");
  const username = String(process.env.XTREAM_USERNAME || "").trim();
  const password = String(process.env.XTREAM_PASSWORD || "");
  if (!base || !username || !password) return null;
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  return { base, username, password };
}

function startPump(entry, key) {
  if (entry.pumping) return;
  entry.pumping = true;
  (async () => {
    let reader;
    try {
      const response = await entry.responsePromise;
      if (!response.ok || !response.body) throw new Error("Upstream stream unavailable");
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const controller of [...entry.subscribers]) {
          try {
            // Disconnect slow consumers rather than allowing unbounded memory growth.
            if (controller.desiredSize !== null && controller.desiredSize <= -4) {
              controller.error(new Error("Relay consumer too slow"));
              entry.subscribers.delete(controller);
            } else {
              controller.enqueue(value);
            }
          } catch {
            entry.subscribers.delete(controller);
          }
        }
        if (entry.subscribers.size === 0) {
          entry.abort.abort();
          break;
        }
      }
    } catch (error) {
      for (const controller of entry.subscribers) {
        try { controller.error(error); } catch {}
      }
    } finally {
      try { reader?.releaseLock(); } catch {}
      for (const controller of entry.subscribers) {
        try { controller.close(); } catch {}
      }
      entry.subscribers.clear();
      if (relays.get(key) === entry) relays.delete(key);
    }
  })();
}

export async function xtreamRelay(requestUrl, kind, id) {
  if (kind !== "live" || !/^\\d+$/.test(String(id))) {
    return new Response("Canal inválido para relay", { status: 400 });
  }
  const cfg = getConfig();
  if (!cfg) return new Response("Xtream não configurado", { status: 503 });

  const key = `${kind}:${id}`;
  let entry = relays.get(key);
  if (!entry && relays.size >= 1) {
    return new Response("O relay já está ocupado por outra transmissão. Encerre-a antes de iniciar outra.", { status: 429 });
  }
  if (entry && entry.subscribers.size >= 2) {
    return new Response("Este relay já está atendendo dois aparelhos.", { status: 429 });
  }
  if (!entry) {
    const ext = /^[a-z0-9]{2,5}$/i.test(process.env.XTREAM_LIVE_EXTENSION || "ts")
      ? (process.env.XTREAM_LIVE_EXTENSION || "ts") : "ts";
    const upstreamUrl = `${cfg.base}/live/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${id}.${ext}`;
    const abort = new AbortController();
    entry = {
      abort,
      subscribers: new Set(),
      pumping: false,
      responsePromise: fetch(upstreamUrl, {
        headers: { "User-Agent": "MaxPlay-Relay/1.0", Accept: "*/*" },
        redirect: "follow",
        signal: abort.signal
      })
    };
    relays.set(key, entry);
  }

  let upstream;
  try {
    upstream = await entry.responsePromise;
  } catch {
    if (relays.get(key) === entry) relays.delete(key);
    return new Response("Não foi possível abrir a transmissão de origem", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    if (relays.get(key) === entry) relays.delete(key);
    return new Response("O provedor recusou a transmissão de origem", { status: 502 });
  }

  let subscriber;
  const body = new ReadableStream({
    start(controller) {
      subscriber = controller;
      entry.subscribers.add(controller);
      startPump(entry, key);
    },
    cancel() {
      if (subscriber) entry.subscribers.delete(subscriber);
      // The pump also stops and aborts the source when no consumers remain.
      if (entry.subscribers.size === 0 && relays.get(key) === entry) {
        entry.abort.abort();
        relays.delete(key);
      }
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "video/mp2t",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-MaxPlay-Relay": "shared-live-source"
    }
  });
}
