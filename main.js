const STORAGE_KEYS = {
  playerA: "tod_simple_player_a_v1",
  playerB: "tod_simple_player_b_v1",
  deckText: "tod_simple_deck_text_v1",
  selfSide: "tod_simple_self_side_v1",
  chat: "tod_simple_chat_v1",
  roomId: "tod_simple_room_id_v1",
  clientId: "tod_simple_client_id_v1",
};

const ROOM_API_URL = "/.netlify/functions/room";

const DEFAULT_DECK_TEXT = [
  "说一件你最近开心的小事",
  "说出你最想立刻去做的一件事",
  "分享一个你的小习惯",
  "描述一次你最难忘的旅行/出行",
  "说出你最喜欢的一部电影/剧",
  "说出你最近一次后悔的事（不想说可跳过）",
  "讲一个你小时候的趣事",
  "给对方一个真诚的夸奖",
  "描述你理想的一天会怎么过",
  "说出你最想学的一项技能",
].join("\n");

function $(id) {
  return document.getElementById(id);
}

const _memoryStore = new Map();

function getLocalStorageSafe() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const testKey = "__tod_simple_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

const _localStorage = getLocalStorageSafe();

function loadText(key, fallback) {
  const k = String(key || "");
  if (!k) return fallback;

  try {
    if (_localStorage) {
      const value = _localStorage.getItem(k);
      if (value !== null) return value;
    }
  } catch {
    // ignore
  }

  if (_memoryStore.has(k)) return String(_memoryStore.get(k));
  return fallback;
}

function saveText(key, value) {
  const k = String(key || "");
  if (!k) return;
  const v = value == null ? "" : String(value);
  _memoryStore.set(k, v);
  try {
    if (_localStorage) _localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}

function loadJson(key, fallback) {
  const text = loadText(key, "");
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    saveText(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function parseDeck(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2000);
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(array) {
  if (!array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

async function copyToClipboard(text, onDone) {
  try {
    await navigator.clipboard.writeText(text);
    onDone?.();
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    onDone?.();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeRoomId(input) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function parseRoomIdFromHash() {
  const hash = String(window.location.hash || "");
  const m = hash.match(/room=([a-zA-Z0-9_-]{1,64})/);
  return m ? m[1] : "";
}

const INITIAL_ROOM_FROM_HASH = normalizeRoomId(parseRoomIdFromHash());

function setHashRoomId(roomId) {
  const clean = normalizeRoomId(roomId);
  const url = new URL(window.location.href);
  url.hash = clean ? `room=${clean}` : "";
  window.history.replaceState(null, "", url.toString());
}

function ensureClientId() {
  const existing = loadText(STORAGE_KEYS.clientId, "");
  if (existing && /^[a-zA-Z0-9_-]{6,80}$/.test(existing)) return existing;
  const id = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  saveText(STORAGE_KEYS.clientId, id);
  return id;
}

function makeChatId() {
  return `${state.clientId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeChatItem(x) {
  if (!x || typeof x !== "object") return null;
  const side = typeof x.side === "string" ? x.side : "";
  const text = typeof x.text === "string" ? x.text : "";
  const ts = typeof x.ts === "number" ? x.ts : 0;
  const id = typeof x.id === "string" ? x.id : "";
  if (!side || !text || !ts) return null;
  return { id, side, text, ts };
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
  out.sort((a, b) => (a.ts - b.ts) || chatKey(a).localeCompare(chatKey(b)));
  return out.slice(-200);
}

function mergeChatLists(a, b) {
  const map = new Map();
  for (const item of normalizeChatList(a)) map.set(chatKey(item), item);
  for (const item of normalizeChatList(b)) map.set(chatKey(item), item);
  const merged = Array.from(map.values());
  merged.sort((x, y) => (x.ts - y.ts) || chatKey(x).localeCompare(chatKey(y)));
  return merged.slice(-200);
}

const els = {
  playerA: $("playerA"),
  playerB: $("playerB"),
  selfA: $("selfA"),
  selfB: $("selfB"),
  roomInput: $("roomInput"),
  roomJoinBtn: $("roomJoinBtn"),
  roomCopyBtn: $("roomCopyBtn"),
  roomStatus: $("roomStatus"),
  card: $("card"),
  deckInput: $("deckInput"),
  resetDeckBtn: $("resetDeckBtn"),
  clearDeckBtn: $("clearDeckBtn"),
  deckCount: $("deckCount"),
  drawBtn: $("drawBtn"),
  copyBtn: $("copyBtn"),
  who: $("who"),
  prompt: $("prompt"),
  stickyWho: $("stickyWho"),
  stickyPrompt: $("stickyPrompt"),
  chatList: $("chatList"),
  chatInput: $("chatInput"),
  chatSendBtn: $("chatSendBtn"),
  chatClearBtn: $("chatClearBtn"),
};

const state = {
  playerA: loadText(STORAGE_KEYS.playerA, "我"),
  playerB: loadText(STORAGE_KEYS.playerB, "你"),
  selfSide: loadText(STORAGE_KEYS.selfSide, "A") === "B" ? "B" : "A",
  deckText: loadText(STORAGE_KEYS.deckText, DEFAULT_DECK_TEXT),
  lastDraw: null,
  lastPlayerSide: "",
  samePlayerStreak: 0,
  chat: normalizeChatList(loadJson(STORAGE_KEYS.chat, [])),
  isDrawing: false,
  clientId: ensureClientId(),
  roomId: INITIAL_ROOM_FROM_HASH || normalizeRoomId(loadText(STORAGE_KEYS.roomId, "")),
  roomTimer: 0,
  roomLastSeenAt: 0,
  roomLastPushedAt: 0,
  roomLastAppliedAt: 0,
  roomIsSyncing: false,
  roomPushTimer: 0,
  isApplyingRemote: false,
  roomDirty: { players: false, deck: false, chat: false, draw: false },
  roomFieldAt: { players: 0, deck: 0, chat: 0, draw: 0 },
  saveTimer: null,
};

function setRoomStatus(text) {
  if (els.roomStatus) els.roomStatus.textContent = text;
}

function roomKeyUrl(roomId) {
  const clean = normalizeRoomId(roomId);
  return clean ? `${ROOM_API_URL}?room=${encodeURIComponent(clean)}` : "";
}

function buildRoomStateLocalOnly() {
  const now = Date.now();
  const localChat = normalizeChatList(state.chat);
  const draw = state.lastDraw && state.lastDraw.ok ? state.lastDraw : null;
  return {
    v: 2,
    updatedAt: now,
    updatedBy: state.clientId,
    players: { a: state.playerA, b: state.playerB, updatedAt: now, updatedBy: state.clientId },
    deck: { text: state.deckText, updatedAt: now, updatedBy: state.clientId },
    chat: { items: localChat, updatedAt: now, updatedBy: state.clientId },
    draw: { last: draw, updatedAt: draw?.ts || 0, updatedBy: draw?.by || "" },
  };
}

function readRoomV2(remote) {
  if (!remote || typeof remote !== "object") return null;
  if (remote.v !== 2) return null;
  const players = remote.players && typeof remote.players === "object" ? remote.players : null;
  const deck = remote.deck && typeof remote.deck === "object" ? remote.deck : null;
  const chat = remote.chat && typeof remote.chat === "object" ? remote.chat : null;
  const draw = remote.draw && typeof remote.draw === "object" ? remote.draw : null;
  return {
    v: 2,
    updatedAt: typeof remote.updatedAt === "number" ? remote.updatedAt : 0,
    players: {
      a: typeof players?.a === "string" ? players.a : "",
      b: typeof players?.b === "string" ? players.b : "",
      updatedAt: typeof players?.updatedAt === "number" ? players.updatedAt : 0,
      updatedBy: typeof players?.updatedBy === "string" ? players.updatedBy : "",
    },
    deck: {
      text: typeof deck?.text === "string" ? deck.text : "",
      updatedAt: typeof deck?.updatedAt === "number" ? deck.updatedAt : 0,
      updatedBy: typeof deck?.updatedBy === "string" ? deck.updatedBy : "",
    },
    chat: {
      items: Array.isArray(chat?.items) ? chat.items : [],
      updatedAt: typeof chat?.updatedAt === "number" ? chat.updatedAt : 0,
      updatedBy: typeof chat?.updatedBy === "string" ? chat.updatedBy : "",
    },
    draw: {
      last: draw?.last && typeof draw.last === "object" ? draw.last : null,
      updatedAt: typeof draw?.updatedAt === "number" ? draw.updatedAt : 0,
      updatedBy: typeof draw?.updatedBy === "string" ? draw.updatedBy : "",
    },
  };
}

function roomV1ToV2(remote) {
  if (!remote || typeof remote !== "object") return null;
  const updatedAt = typeof remote.updatedAt === "number" ? remote.updatedAt : 0;
  const playerA = typeof remote.playerA === "string" ? remote.playerA : "";
  const playerB = typeof remote.playerB === "string" ? remote.playerB : "";
  const deckText = typeof remote.deckText === "string" ? remote.deckText : "";
  const chat = Array.isArray(remote.chat) ? remote.chat : [];
  const lastDraw = remote.lastDraw && typeof remote.lastDraw === "object" ? remote.lastDraw : null;
  const drawTs = typeof lastDraw?.ts === "number" ? lastDraw.ts : 0;
  return {
    v: 2,
    updatedAt,
    players: { a: playerA, b: playerB, updatedAt, updatedBy: typeof remote.updatedBy === "string" ? remote.updatedBy : "" },
    deck: { text: deckText, updatedAt, updatedBy: typeof remote.updatedBy === "string" ? remote.updatedBy : "" },
    chat: { items: chat, updatedAt, updatedBy: typeof remote.updatedBy === "string" ? remote.updatedBy : "" },
    draw: { last: lastDraw, updatedAt: drawTs, updatedBy: typeof lastDraw?.by === "string" ? lastDraw.by : "" },
  };
}

function markRoomDirty(field) {
  if (!state.roomId) return;
  if (state.isApplyingRemote) return;
  if (!state.roomDirty[field]) state.roomDirty[field] = true;
  schedulePushRoomState();
}

function applyRoomState(remoteRaw) {
  const v2 = readRoomV2(remoteRaw) || roomV1ToV2(remoteRaw);
  if (!v2) return;

  state.isApplyingRemote = true;
  try {
    const nextChat = mergeChatLists(state.chat, v2.chat.items);
    const chatChanged = JSON.stringify(nextChat) !== JSON.stringify(state.chat);
    if (chatChanged) {
      state.chat = nextChat;
      saveJson(STORAGE_KEYS.chat, state.chat);
      renderChat();
    }
    state.roomFieldAt.chat = Math.max(state.roomFieldAt.chat, v2.chat.updatedAt || 0);

    const remoteDraw = v2.draw.last && v2.draw.last.ok ? v2.draw.last : null;
    const localDrawTs = typeof state.lastDraw?.ts === "number" ? state.lastDraw.ts : 0;
    const remoteDrawTs = typeof remoteDraw?.ts === "number" ? remoteDraw.ts : 0;
    if (remoteDraw && (!state.lastDraw || remoteDrawTs >= localDrawTs)) {
      state.lastDraw = remoteDraw;
      showDraw(state.lastDraw);
      state.roomFieldAt.draw = Math.max(state.roomFieldAt.draw, remoteDrawTs);
    }

    if (v2.players.updatedAt > state.roomFieldAt.players) {
      state.playerA = v2.players.a;
      saveText(STORAGE_KEYS.playerA, state.playerA);
      if (els.playerA) els.playerA.value = state.playerA;

      state.playerB = v2.players.b;
      saveText(STORAGE_KEYS.playerB, state.playerB);
      if (els.playerB) els.playerB.value = state.playerB;

      state.roomFieldAt.players = v2.players.updatedAt;
      updateSelfButtons();
    }

    if (v2.deck.updatedAt > state.roomFieldAt.deck) {
      if (typeof v2.deck.text === "string") {
        state.deckText = v2.deck.text;
        saveText(STORAGE_KEYS.deckText, state.deckText);
        if (els.deckInput) els.deckInput.value = state.deckText;
        renderDeckCount();
      }
      state.roomFieldAt.deck = v2.deck.updatedAt;
    }

    state.roomLastAppliedAt = Math.max(state.roomLastAppliedAt, v2.updatedAt || 0);
    state.roomLastSeenAt = Date.now();
  } finally {
    state.isApplyingRemote = false;
  }
}

async function pullRoomStateOnce() {
  if (!state.roomId) return;
  const url = roomKeyUrl(state.roomId);
  if (!url) return;
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    const remote = safeJsonParse(text);
    applyRoomState(remote);
  } catch {
    return;
  }
}

async function pushRoomStateOnce() {
  if (!state.roomId) return;
  const url = roomKeyUrl(state.roomId);
  if (!url) return;
  try {
    const remoteRes = await fetch(url, { method: "GET", cache: "no-store" });
    const remoteText = remoteRes.ok ? await remoteRes.text() : "";
    const remoteRaw = safeJsonParse(remoteText);
    const remote = readRoomV2(remoteRaw) || roomV1ToV2(remoteRaw) || null;

    const now = Date.now();
    const next = remote || buildRoomStateLocalOnly();
    next.updatedAt = now;
    next.updatedBy = state.clientId;

    const localChat = normalizeChatList(state.chat);
    const remoteChat = remote ? remote.chat.items : [];
    const mergedChat = mergeChatLists(remoteChat, localChat);
    next.chat.items = mergedChat;
    const mergedChatChanged = !remote || JSON.stringify(mergedChat) !== JSON.stringify(normalizeChatList(remoteChat));
    if (state.roomDirty.chat || mergedChatChanged) {
      next.chat.updatedAt = now;
      next.chat.updatedBy = state.clientId;
    } else if (remote) {
      next.chat.updatedAt = remote.chat.updatedAt;
      next.chat.updatedBy = remote.chat.updatedBy;
    }

    if (state.roomDirty.players) {
      next.players.a = state.playerA;
      next.players.b = state.playerB;
      next.players.updatedAt = now;
      next.players.updatedBy = state.clientId;
    } else if (remote) {
      next.players = remote.players;
    }

    if (state.roomDirty.deck) {
      next.deck.text = state.deckText;
      next.deck.updatedAt = now;
      next.deck.updatedBy = state.clientId;
    } else if (remote) {
      next.deck = remote.deck;
    }

    const localDraw = state.lastDraw && state.lastDraw.ok ? state.lastDraw : null;
    const remoteDraw = remote ? (remote.draw.last && remote.draw.last.ok ? remote.draw.last : null) : null;
    const localDrawTs = typeof localDraw?.ts === "number" ? localDraw.ts : 0;
    const remoteDrawTs = typeof remoteDraw?.ts === "number" ? remoteDraw.ts : 0;
    if (state.roomDirty.draw && localDraw) {
      next.draw.last = localDraw;
      next.draw.updatedAt = localDrawTs || now;
      next.draw.updatedBy = localDraw.by || state.clientId;
    } else if (remoteDrawTs >= localDrawTs && remoteDraw) {
      next.draw.last = remoteDraw;
      next.draw.updatedAt = remoteDrawTs;
      next.draw.updatedBy = remoteDraw.by || "";
    } else if (localDraw) {
      next.draw.last = localDraw;
      next.draw.updatedAt = localDrawTs;
      next.draw.updatedBy = localDraw.by || state.clientId;
    } else {
      next.draw.last = null;
      next.draw.updatedAt = 0;
      next.draw.updatedBy = "";
    }

    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });

    state.roomDirty.players = false;
    state.roomDirty.deck = false;
    state.roomDirty.chat = false;
    state.roomDirty.draw = false;
    state.roomLastPushedAt = now;
  } catch {
    return;
  }
}

function schedulePushRoomState() {
  if (!state.roomId) return;
  if (state.isApplyingRemote) return;
  if (state.roomPushTimer) window.clearTimeout(state.roomPushTimer);
  state.roomPushTimer = window.setTimeout(() => {
    pushRoomStateOnce();
  }, 350);
}

async function joinRoom(roomId) {
  const clean = normalizeRoomId(roomId);
  if (!clean) {
    setRoomStatus("房间码无效");
    return;
  }
  state.roomId = clean;
  saveText(STORAGE_KEYS.roomId, state.roomId);
  setHashRoomId(state.roomId);
  if (els.roomInput) els.roomInput.value = state.roomId;
  if (els.roomCopyBtn) els.roomCopyBtn.disabled = false;
  setRoomStatus("连接中…");

  await pullRoomStateOnce();
  await pushRoomStateOnce();
  await sleep(80);
  await pullRoomStateOnce();

  if (state.roomTimer) window.clearInterval(state.roomTimer);
  state.roomTimer = window.setInterval(() => {
    pullRoomStateOnce();
  }, 1200);
  setRoomStatus("已连接");
}

function copyRoomLink() {
  if (!state.roomId) return;
  const url = new URL(window.location.href);
  url.hash = `room=${state.roomId}`;
  copyToClipboard(url.toString(), () => {
    if (els.roomCopyBtn) {
      const prev = els.roomCopyBtn.textContent;
      els.roomCopyBtn.textContent = "已复制";
      setTimeout(() => {
        els.roomCopyBtn.textContent = prev || "复制链接";
      }, 900);
    }
  });
}

function renderDeckCount() {
  const deck = parseDeck(state.deckText);
  els.deckCount.textContent = String(deck.length);
}

function updateSelfButtons() {
  for (const btn of [els.selfA, els.selfB]) {
    btn.classList.remove("is-active");
    btn.setAttribute("aria-selected", "false");
  }
  if (state.selfSide === "A") {
    els.selfA.classList.add("is-active");
    els.selfA.setAttribute("aria-selected", "true");
  } else {
    els.selfB.classList.add("is-active");
    els.selfB.setAttribute("aria-selected", "true");
  }

  const a = (state.playerA || "").trim();
  const b = (state.playerB || "").trim();
  els.selfA.textContent = a ? `玩家 1：${a}` : "玩家 1";
  els.selfB.textContent = b ? `玩家 2：${b}` : "玩家 2";
}

function setCopyEnabled(enabled) {
  els.copyBtn.disabled = !enabled;
  if (!enabled) els.copyBtn.textContent = "复制";
}

function scheduleSaveDeckText(nextText) {
  state.deckText = nextText;
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    saveText(STORAGE_KEYS.deckText, state.deckText);
    renderDeckCount();
    markRoomDirty("deck");
  }, 250);
}

function currentPlayers() {
  const a = (state.playerA || "").trim();
  const b = (state.playerB || "").trim();
  const players = [];
  if (a) players.push({ side: "A", name: a });
  if (b) players.push({ side: "B", name: b });
  return players.slice(0, 2);
}

function nextPlayer(players) {
  if (!players.length) {
    state.lastPlayerSide = "";
    state.samePlayerStreak = 0;
    return null;
  }
  if (players.length === 1) {
    const side = players[0].side;
    state.samePlayerStreak = state.lastPlayerSide === side ? state.samePlayerStreak + 1 : 1;
    state.lastPlayerSide = side;
    return players[0];
  }

  const picked = pickRandom(players) || players[0];
  if (state.lastPlayerSide && picked.side === state.lastPlayerSide && state.samePlayerStreak >= 2) {
    const others = players.filter((p) => p.side !== state.lastPlayerSide);
    const forced = pickRandom(others) || others[0] || picked;
    state.samePlayerStreak = state.lastPlayerSide === forced.side ? state.samePlayerStreak + 1 : 1;
    state.lastPlayerSide = forced.side;
    return forced;
  }

  state.samePlayerStreak = state.lastPlayerSide === picked.side ? state.samePlayerStreak + 1 : 1;
  state.lastPlayerSide = picked.side;
  return picked;
}

function drawOnce() {
  const deck = parseDeck(state.deckText);
  if (!deck.length) return { ok: false, message: "题库为空，请先在下方输入题目（每行一题）。" };
  const players = currentPlayers();
  const player = nextPlayer(players);
  const text = pickRandom(deck);
  if (!text) return { ok: false, message: "题库为空，请先在下方输入题目（每行一题）。" };
  const ts = Date.now();
  return { ok: true, player, text, ts, id: `d_${ts.toString(36)}_${Math.random().toString(36).slice(2, 8)}`, by: state.clientId };
}

function displayNameForSide(side) {
  if (side === "A") return (state.playerA || "").trim() || "玩家 1";
  if (side === "B") return (state.playerB || "").trim() || "玩家 2";
  return "玩家";
}

function labelForDrawPlayer(player) {
  if (!player) return "未指定玩家";
  const name = player.name || displayNameForSide(player.side);
  if (player.side === state.selfSide) return `轮到：我（${name}）`;
  return `轮到：对方（${name}）`;
}

function syncStickyDraw() {
  if (!els.stickyWho && !els.stickyPrompt) return;
  const whoText = els.who ? els.who.textContent : "";
  const promptText = els.prompt ? els.prompt.textContent : "";
  if (els.stickyWho) els.stickyWho.textContent = whoText;
  if (els.stickyPrompt) els.stickyPrompt.textContent = promptText;
}

function showDraw(result) {
  if (!result.ok) {
    els.who.textContent = "未指定玩家";
    els.prompt.textContent = result.message;
    syncStickyDraw();
    setCopyEnabled(false);
    state.lastDraw = null;
    return;
  }
  els.who.textContent = labelForDrawPlayer(result.player);
  els.prompt.textContent = result.text;
  syncStickyDraw();
  setCopyEnabled(true);
  state.lastDraw = result;
  markRoomDirty("draw");
}

function setDrawingUI(isDrawing) {
  state.isDrawing = isDrawing;
  els.drawBtn.disabled = isDrawing;
  if (els.card) els.card.classList.toggle("is-drawing", isDrawing);
}

function animateDraw(finalResult) {
  const deck = parseDeck(state.deckText);
  const players = currentPlayers();
  const endAt = performance.now() + 1700;

  setDrawingUI(true);
  setCopyEnabled(false);
  els.who.textContent = "抽取中…";

  const tick = () => {
    const now = performance.now();
    const remaining = endAt - now;
    if (remaining <= 0) {
      setDrawingUI(false);
      showDraw(finalResult);
      return;
    }

    const text = pickRandom(deck) || finalResult.text;
    const randomPlayer = players.length ? pickRandom(players) : null;
    els.prompt.textContent = text;
    els.who.textContent = randomPlayer ? labelForDrawPlayer(randomPlayer) : "抽取中…";
    syncStickyDraw();

    const nextDelay = remaining < 450 ? 170 : remaining < 950 ? 120 : 70;
    window.setTimeout(tick, nextDelay);
  };

  tick();
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderChat() {
  els.chatList.innerHTML = "";
  const list = Array.isArray(state.chat) ? state.chat : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "暂无消息";
    els.chatList.appendChild(empty);
    return;
  }

  for (const item of list) {
    const wrap = document.createElement("div");
    wrap.className = `chat-item${item.side === state.selfSide ? " is-me" : ""}`;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = `${displayNameForSide(item.side)} · ${formatTime(item.ts)}`;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = item.text || "";

    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    els.chatList.appendChild(wrap);
  }
  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function sendChat() {
  const text = String(els.chatInput.value || "").replace(/\r\n/g, "\n").trim();
  if (!text) return;
  const msg = { id: makeChatId(), side: state.selfSide, text, ts: Date.now() };
  state.chat = mergeChatLists(state.chat, [msg]);
  saveJson(STORAGE_KEYS.chat, state.chat);
  els.chatInput.value = "";
  autoSizeChatInput();
  renderChat();
  markRoomDirty("chat");
}

function autoSizeChatInput() {
  const el = els.chatInput;
  if (!el) return;
  el.style.height = "auto";
  const cs = window.getComputedStyle(el);
  const maxH = parseFloat(cs.maxHeight) || 140;
  const next = Math.min(el.scrollHeight, maxH);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
}

function bindEvents() {
  els.playerA.addEventListener("input", () => {
    state.playerA = els.playerA.value;
    saveText(STORAGE_KEYS.playerA, state.playerA);
    state.lastPlayerSide = "";
    state.samePlayerStreak = 0;
    updateSelfButtons();
    markRoomDirty("players");
  });
  els.playerB.addEventListener("input", () => {
    state.playerB = els.playerB.value;
    saveText(STORAGE_KEYS.playerB, state.playerB);
    state.lastPlayerSide = "";
    state.samePlayerStreak = 0;
    updateSelfButtons();
    markRoomDirty("players");
  });

  els.selfA.addEventListener("click", () => {
    state.selfSide = "A";
    saveText(STORAGE_KEYS.selfSide, state.selfSide);
    updateSelfButtons();
    if (state.lastDraw) showDraw(state.lastDraw);
    renderChat();
  });
  els.selfB.addEventListener("click", () => {
    state.selfSide = "B";
    saveText(STORAGE_KEYS.selfSide, state.selfSide);
    updateSelfButtons();
    if (state.lastDraw) showDraw(state.lastDraw);
    renderChat();
  });

  els.deckInput.addEventListener("input", () => {
    scheduleSaveDeckText(els.deckInput.value);
  });

  els.resetDeckBtn.addEventListener("click", () => {
    state.deckText = DEFAULT_DECK_TEXT;
    els.deckInput.value = state.deckText;
    saveText(STORAGE_KEYS.deckText, state.deckText);
    renderDeckCount();
    markRoomDirty("deck");
  });

  els.clearDeckBtn.addEventListener("click", () => {
    state.deckText = "";
    els.deckInput.value = "";
    saveText(STORAGE_KEYS.deckText, state.deckText);
    renderDeckCount();
    showDraw({ ok: false, message: "题库已清空，请先在下方输入题目（每行一题）。" });
    markRoomDirty("deck");
  });

  els.drawBtn.addEventListener("click", () => {
    if (state.isDrawing) return;
    const finalResult = drawOnce();
    if (!finalResult.ok) {
      showDraw(finalResult);
      return;
    }
    animateDraw(finalResult);
  });

  els.copyBtn.addEventListener("click", async () => {
    if (!state.lastDraw || !state.lastDraw.ok) return;
    const playerLine = state.lastDraw.player ? labelForDrawPlayer(state.lastDraw.player) : "题目";
    const text = `${playerLine}\n${state.lastDraw.text}`;
    await copyToClipboard(text, () => {
      els.copyBtn.textContent = "已复制";
      setTimeout(() => {
        els.copyBtn.textContent = "复制";
      }, 900);
    });
  });

  els.chatSendBtn.addEventListener("click", () => {
    sendChat();
    els.chatInput.focus();
  });
  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      sendChat();
    }
  });
  els.chatInput.addEventListener("input", () => {
    autoSizeChatInput();
  });
  els.chatClearBtn.addEventListener("click", () => {
    state.chat = [];
    saveJson(STORAGE_KEYS.chat, state.chat);
    renderChat();
    markRoomDirty("chat");
  });

  els.roomJoinBtn.addEventListener("click", () => {
    joinRoom(els.roomInput.value);
  });
  els.roomInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    joinRoom(els.roomInput.value);
  });
  els.roomCopyBtn.addEventListener("click", () => {
    copyRoomLink();
  });
}

function hydrateUI() {
  els.playerA.value = state.playerA;
  els.playerB.value = state.playerB;
  els.deckInput.value = state.deckText;
  if (els.roomInput) els.roomInput.value = state.roomId || "";
  if (els.roomCopyBtn) els.roomCopyBtn.disabled = !state.roomId;
  renderDeckCount();
  setCopyEnabled(false);
  updateSelfButtons();
  renderChat();
  autoSizeChatInput();
  syncStickyDraw();
}

bindEvents();
hydrateUI();

if (INITIAL_ROOM_FROM_HASH) joinRoom(state.roomId);
