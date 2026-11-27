// Shares one authorized Xtream upstream stream among concurrent Max Play viewers.
// The relay is process-local: use a single Render instance for this feature.
export class SharedStreamRelay {
  constructor({ fetcher = fetch, maxViewers = 5, queueBytes = 2 * 1024 * 1024 } = {}) {
    this.fetcher = fetcher;
    this.maxViewers = maxViewers;
    this.queueBytes = queueBytes;
    this.sessions = new Map();
  }

  open(key, upstreamUrl) {
    let session = this.sessions.get(key);
    if (!session) {
      session = { key, upstreamUrl, clients: new Set(), controller: new AbortController(), started: false };
      this.sessions.set(key, session);
    }

    if (session.clients.size >= this.maxViewers) {
      return new Response("Limite de aparelhos do relay atingido", { status: 429 });
    }

    let client;
    const body = new ReadableStream({
      start: (controller) => {
        client = controller;
        session.clients.add(controller);
        if (!session.started) {
          session.started = true;
          this.pump(session).catch(() => this.finish(session, "error"));
        }
      },
      cancel: () => this.removeClient(session, client)
    }, {
      highWaterMark: this.queueBytes,
      size: (chunk) => chunk.byteLength
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "video/mp2t",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Max-Play-Relay": "shared"
      }
    });
  }

  async pump(session) {
    const upstream = await this.fetcher(session.upstreamUrl, {
      method: "GET",
      headers: { "User-Agent": "MaxPlay/1.0", Accept: "*/*" },
      redirect: "follow",
      signal: session.controller.signal
    });
    if (!upstream.ok || !upstream.body) throw new Error(`Upstream status ${upstream.status}`);

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const client of [...session.clients]) {
          if (client.desiredSize !== null && client.desiredSize < value.byteLength) {
            this.removeClient(session, client, new Error("Cliente não acompanha a transmissão"));
            continue;
          }
          try { client.enqueue(value); }
          catch { this.removeClient(session, client); }
        }
        if (session.clients.size === 0) {
          session.controller.abort();
          break;
        }
      }
      this.finish(session, "close");
    } finally {
      reader.releaseLock();
    }
  }

  removeClient(session, client, error) {
    if (!client || !session.clients.delete(client)) return;
    try {
      if (error) client.error(error);
      else client.close();
    } catch {}
    if (session.clients.size === 0) {
      session.controller.abort();
      if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    }
  }

  finish(session, mode) {
    for (const client of [...session.clients]) this.removeClient(session, client,
      mode === "error" ? new Error("Falha na transmissão de origem") : undefined);
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
  }
}
