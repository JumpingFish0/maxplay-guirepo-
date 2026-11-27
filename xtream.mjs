import { fetchJson, fetchText } from "./http.mjs";
import { SharedStreamRelay } from "./shared-relay.mjs";

const proxyRefs = new Map();
const relayRefs = new Map();
const sharedRelay = new SharedStreamRelay({ maxViewers: 5 });

function makeRelayRef(kind, id) {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  relayRefs.set(token, { kind, id: String(id), expires: Date.now() + 30 * 60 * 1000 });
  if (relayRefs.size > 5000) {
    for (const [key, value] of relayRefs) if (value.expires < Date.now()) relayRefs.delete(key);
  }
  return token;
}

function makeProxyRef(url, allowExternal = false) {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  proxyRefs.set(token, { url, allowExternal, expires: Date.now() + 30 * 60 * 1000 });
  if (proxyRefs.size > 5000) {
    for (const [key, value] of proxyRefs) if (value.expires < Date.now()) proxyRefs.delete(key);
  }
  return token;
}

function config() {
  const base = String(process.env.XTREAM_BASE_URL || "").trim().replace(/\/+$/, "");
  const username = String(process.env.XTREAM_USERNAME || "").trim();
  const password = String(process.env.XTREAM_PASSWORD || "");
  if (!base || !username || !password) return null;
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  return { base, username, password, host: parsed.host };
}

function apiUrl(cfg, params = {}) {
  const u = new URL(`${cfg.base}/player_api.php`);
  u.searchParams.set("username", cfg.username);
  u.searchParams.set("password", cfg.password);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function xtreamConfigured() { return Boolean(config()); }

export async function xtreamApi(params = {}) {
  const cfg = config();
  if (!cfg) return { error: "Xtream Codes não configurado no servidor", status: 503 };
  try {
    const data = await fetchJson(apiUrl(cfg, params), { timeoutMs: 15000 });
    if (data === null) return { error: "Resposta inválida do provedor Xtream Codes", status: 502 };
    return { data };
  } catch {
    return { error: "Não foi possível conectar ao provedor Xtream Codes", status: 502 };
  }
}

export async function xtreamPlaybackUrl(kind, id, requestedExtension = "") {
  const cfg = config();
  if (!cfg) return null;
  const types = {
    live: ["live", "m3u8"],
    movie: ["movie", "mp4"],
    series: ["series", "mp4"],
    episode: ["series", "mp4"]
  };
  const item = types[kind];
  if (!item || !/^\d+$/.test(String(id))) return null;
  if (kind === "live") return `/api/xtream/relay?ref=${makeRelayRef(kind, id)}`;
  const configuredExt = kind === "live" ? (process.env.XTREAM_LIVE_EXTENSION || "ts") :
    (kind === "movie" ? (process.env.XTREAM_VOD_EXTENSION || "mp4") : "mp4");
  const ext = requestedExtension || configuredExt;
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext : item[1];
  const path = kind === "live" ? "live" : kind === "movie" ? "movie" : "series";
  const upstream = `${cfg.base}/${path}/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${id}.${safeExt}`;
  return `/api/xtream/proxy?ref=${makeProxyRef(upstream)}`;
}



export function xtreamRelay(requestUrl) {
  const cfg = config();
  if (!cfg) return new Response("Xtream não configurado", { status: 503 });
  const ref = requestUrl.searchParams.get("ref") || "";
  const stored = relayRefs.get(ref);
  if (!stored || stored.expires < Date.now() || stored.kind !== "live" || !/^\\d+$/.test(stored.id)) {
    relayRefs.delete(ref);
    return new Response("Referência de relay expirada ou inválida", { status: 404 });
  }
  const ext = String(process.env.XTREAM_LIVE_EXTENSION || "ts").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "ts";
  const upstreamUrl = `${cfg.base}/live/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${stored.id}.${ext}`;
  return sharedRelay.open(`live:${stored.id}`, upstreamUrl);
}

export async function xtreamPlaylist(requestUrl) {
  const cfg = config();
  if (!cfg) return new Response("Xtream não configurado", { status: 503 });
  const output = requestUrl.searchParams.get("output") === "m3u8" ? "m3u8" : "ts";
  const upstreamUrl = new URL(`${cfg.base}/get.php`);
  upstreamUrl.searchParams.set("username", cfg.username);
  upstreamUrl.searchParams.set("password", cfg.password);
  upstreamUrl.searchParams.set("type", "m3u_plus");
  upstreamUrl.searchParams.set("output", output);
  try {
    const upstream = await fetchText(upstreamUrl.toString(), { timeoutMs: 30000 });
    if (!upstream.ok || !upstream.text.trimStart().startsWith("#EXTM3U")) {
      return new Response("O fornecedor não retornou uma playlist M3U válida", { status: 502 });
    }
    const baseUrl = upstream.url || upstreamUrl.toString();
    const rewritten = upstream.text.split(/\\r?\\n/).map((line) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return line;
      try {
        const target = new URL(value, baseUrl);
        if (!["http:", "https:"].includes(target.protocol)) return "";
        return `/api/xtream/proxy?ref=${makeProxyRef(target.toString(), true)}`;
      } catch {
        return line;
      }
    }).join("\\n");
    return new Response(rewritten, {
      headers: {
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Content-Disposition": 'inline; filename="maxplay-unificada.m3u"',
        "Cache-Control": "private, no-store",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch {
    return new Response("Não foi possível gerar a playlist do Xtream", { status: 502 });
  }
}

export async function proxyXtream(requestUrl, requestHeaders = new Headers()) {
  const cfg = config();
  if (!cfg) return new Response("Xtream não configurado", { status: 503 });
  const ref = requestUrl.searchParams.get("ref") || "";
  const stored = proxyRefs.get(ref);
  if (!stored || stored.expires < Date.now()) {
    proxyRefs.delete(ref);
    return new Response("Referência de mídia expirada ou inválida", { status: 404 });
  }
  const raw = stored.url;
  let target;
  try { target = new URL(raw); } catch { return new Response("URL inválida", { status: 400 }); }
  if ((target.host !== cfg.host && !stored.allowExternal) || !["http:", "https:"].includes(target.protocol)) {
    return new Response("Destino não permitido", { status: 403 });
  }
  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": "MaxPlay/1.0", Accept: "*/*", ...(requestHeaders.get("range") ? { Range: requestHeaders.get("range") } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) return new Response("Falha no provedor de mídia", { status: 502 });
    const contentType = upstream.headers.get("content-type") || "";
    if (/mpegurl|application\/vnd\.apple/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(target.pathname)) {
      const playlist = await upstream.text();
      const base = upstream.url || target.toString();
      const rewritten = playlist.split(/\r?\n/).map(line => {
        const t = line.trim();
        if (!t || t.startsWith("#")) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            try {
              const abs = new URL(uri, base).toString();
              return `URI="/api/xtream/proxy?ref=${makeProxyRef(abs, stored.allowExternal)}"`;
            } catch { return `URI="${uri}"`; }
          });
        }
        try {
          const abs = new URL(t, base).toString();
          return `/api/xtream/proxy?ref=${makeProxyRef(abs)}`;
        } catch { return line; }
      }).join("\n");
      return new Response(rewritten, { headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      }});
    }
    const responseHeaders = {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes"
    };
    for (const header of ["content-length", "content-range"]) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders[header] = value;
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response("Não foi possível obter a mídia", { status: 502 });
  }
}

export function xtreamSafeItem(item, kind) {
  const id = item?.stream_id ?? item?.series_id ?? item?.id;
  return {
    id: String(id ?? ""),
    type: kind,
    name: String(item?.name || item?.title || "Sem título"),
    categoryId: String(item?.category_id || ""),
    poster: item?.stream_icon || item?.cover || item?.cover_big || null,
    plot: item?.plot || item?.description || "",
    rating: item?.rating || null,
    added: item?.added || null,
    containerExtension: item?.container_extension || null,
    playback: kind === "series" ? null : `/api/xtream/play/${kind}/${encodeURIComponent(String(id ?? ""))}`
  };
}
