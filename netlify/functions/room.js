const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "tod_simple_rooms_v1";
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function jsonResponse(statusCode, data, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(data),
  };
}

function textResponse(statusCode, text, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders || {}),
    },
    body: String(text || ""),
  };
}

function normalizeRoomId(input) {
  const clean = String(input || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  if (!clean) return "";
  if (!ROOM_ID_RE.test(clean)) return "";
  return clean;
}

function normalizeString(value, maxLen) {
  const s = String(value || "");
  if (!maxLen) return s;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeChatItem(x) {
  if (!x || typeof x !== "object") return null;
  const side = x.side === "A" || x.side === "B" ? x.side : "";
  const text = typeof x.text === "string" ? x.text : "";
  const ts = typeof x.ts === "number" ? x.ts : 0;
  const id = typeof x.id === "string" ? x.id : "";
  if (!side || !text || !ts) return null;
  return { id: normalizeString(id, 120), side, text: normalizeString(text, 2000), ts };
}

function chatKey(x) {
  if (!x) return "";
  if (x.id) return `id:${x.id}`;
  return `t:${x.ts}|s:${x.side}|x:${x.text}`;
}

function normalizeChatList(list) {
  const out = [];
  const raw = Array.isArray(list) ? list : [];
  for (const item of raw) {
    const n = normalizeChatItem(item);
    if (n) out.push(n);
  }
  out.sort((a, b) => a.ts - b.ts || chatKey(a).localeCompare(chatKey(b)));
  return out.slice(-200);
}

function mergeChatLists(a, b) {
  const map = new Map();
  for (const item of normalizeChatList(a)) map.set(chatKey(item), item);
  for (const item of normalizeChatList(b)) map.set(chatKey(item), item);
  const merged = Array.from(map.values());
  merged.sort((x, y) => x.ts - y.ts || chatKey(x).localeCompare(chatKey(y)));
  return merged.slice(-200);
}

function readRoomV2(remote) {
  if (!remote || typeof remote !== "object") return null;
  if (remote.v !== 2) return null;
  const players = remote.players && typeof remote.players === "object" ? remote.players : null;
  const deck = remote.deck && typeof remote.deck === "object" ? remote.deck : null;
  const chat = remote.chat && typeof remote.chat === "object" ? remote.chat : null;
  const draw = remote.draw && typeof remote.draw === "object" ? remote.draw : null;

  const drawLast = draw?.last && typeof draw.last === "object" ? draw.last : null;
  const normalizedDrawLast =
    drawLast && drawLast.ok
      ? {
          ok: true,
          player: drawLast.player && typeof drawLast.player === "object" ? drawLast.player : null,
          text: normalizeString(drawLast.text, 2000),
          ts: typeof drawLast.ts === "number" ? drawLast.ts : 0,
          id: normalizeString(drawLast.id, 120),
          by: normalizeString(drawLast.by, 120),
        }
      : null;

  return {
    v: 2,
    updatedAt: typeof remote.updatedAt === "number" ? remote.updatedAt : 0,
    updatedBy: typeof remote.updatedBy === "string" ? remote.updatedBy : "",
    players: {
      a: typeof players?.a === "string" ? normalizeString(players.a, 80) : "",
      b: typeof players?.b === "string" ? normalizeString(players.b, 80) : "",
      updatedAt: typeof players?.updatedAt === "number" ? players.updatedAt : 0,
      updatedBy: typeof players?.updatedBy === "string" ? players.updatedBy : "",
    },
    deck: {
      text: typeof deck?.text === "string" ? normalizeString(deck.text, 100_000) : "",
      updatedAt: typeof deck?.updatedAt === "number" ? deck.updatedAt : 0,
      updatedBy: typeof deck?.updatedBy === "string" ? deck.updatedBy : "",
    },
    chat: {
      items: normalizeChatList(chat?.items),
      updatedAt: typeof chat?.updatedAt === "number" ? chat.updatedAt : 0,
      updatedBy: typeof chat?.updatedBy === "string" ? chat.updatedBy : "",
    },
    draw: {
      last: normalizedDrawLast,
      updatedAt: typeof draw?.updatedAt === "number" ? draw.updatedAt : 0,
      updatedBy: typeof draw?.updatedBy === "string" ? draw.updatedBy : "",
    },
  };
}

function mergeRoomState(existing, incoming) {
  if (!existing) {
    const now = Date.now();
    return { ...incoming, updatedAt: now, updatedBy: incoming.updatedBy || "" };
  }

  const now = Date.now();
  const out = {
    v: 2,
    updatedAt: now,
    updatedBy: incoming.updatedBy || existing.updatedBy || "",
    players:
      incoming.players.updatedAt >= existing.players.updatedAt ? incoming.players : existing.players,
    deck: incoming.deck.updatedAt >= existing.deck.updatedAt ? incoming.deck : existing.deck,
    chat: {
      items: mergeChatLists(existing.chat.items, incoming.chat.items),
      updatedAt: Math.max(existing.chat.updatedAt, incoming.chat.updatedAt) || now,
      updatedBy: incoming.chat.updatedBy || existing.chat.updatedBy || "",
    },
    draw: (() => {
      const a = existing.draw.last && existing.draw.last.ok ? existing.draw.last : null;
      const b = incoming.draw.last && incoming.draw.last.ok ? incoming.draw.last : null;
      const ats = typeof a?.ts === "number" ? a.ts : 0;
      const bts = typeof b?.ts === "number" ? b.ts : 0;
      if (b && bts >= ats) return incoming.draw;
      return existing.draw;
    })(),
  };

  return out;
}

exports.handler = async function handler(event) {
  if (event && typeof event.blobs === "string" && event.blobs) {
    connectLambda(event);
  }

  const method = String(event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  const qs = event.queryStringParameters || {};
  const roomId = normalizeRoomId(qs.room || qs.roomId || qs.id || "");
  if (!roomId) return textResponse(400, "Invalid room id");

  const store = getStore(STORE_NAME);
  const key = `rooms/${roomId}.json`;

  try {
    if (method === "GET") {
      const existingRaw = await store.get(key, { type: "json" });
      if (!existingRaw) {
        return {
          statusCode: 404,
          headers: { "Cache-Control": "no-store" },
          body: "",
        };
      }
      return jsonResponse(200, existingRaw);
    }

    if (method === "DELETE") {
      await store.delete(key);
      return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
    }

    if (method === "PUT" || method === "POST") {
      let incomingRaw;
      try {
        incomingRaw = event.body ? JSON.parse(event.body) : null;
      } catch {
        return textResponse(400, "Invalid JSON");
      }

      const incoming = readRoomV2(incomingRaw);
      if (!incoming) return textResponse(400, "Invalid room state");

      const existing = readRoomV2(await store.get(key, { type: "json" })) || null;
      const merged = mergeRoomState(existing, incoming);
      await store.setJSON(key, merged);

      return jsonResponse(200, merged);
    }

    return textResponse(405, "Method not allowed", {
      Allow: "GET,PUT,POST,DELETE,OPTIONS",
    });
  } catch {
    return textResponse(500, "Internal error");
  }
};
