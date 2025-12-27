const STORAGE_KEYS = {
  playerA: "tod_simple_player_a_v1",
  playerB: "tod_simple_player_b_v1",
  deckText: "tod_simple_deck_text_v1",
  selfSide: "tod_simple_self_side_v1",
  chat: "tod_simple_chat_v1",
};

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

function loadText(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  return raw;
}

function saveText(key, value) {
  localStorage.setItem(key, value);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

const els = {
  playerA: $("playerA"),
  playerB: $("playerB"),
  selfA: $("selfA"),
  selfB: $("selfB"),
  card: $("card"),
  deckInput: $("deckInput"),
  resetDeckBtn: $("resetDeckBtn"),
  clearDeckBtn: $("clearDeckBtn"),
  deckCount: $("deckCount"),
  drawBtn: $("drawBtn"),
  copyBtn: $("copyBtn"),
  who: $("who"),
  prompt: $("prompt"),
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
  playerSideBag: [],
  playersKey: "",
  chat: Array.isArray(loadJson(STORAGE_KEYS.chat, [])) ? loadJson(STORAGE_KEYS.chat, []).slice(0, 200) : [],
  isDrawing: false,
  saveTimer: null,
};

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
    state.playerSideBag = [];
    state.playersKey = "";
    return null;
  }
  if (players.length === 1) {
    state.lastPlayerSide = players[0].side;
    state.playerSideBag = [];
    state.playersKey = `${players[0].side}:${players[0].name}`;
    return players[0];
  }

  const key = players.map((p) => `${p.side}:${p.name}`).join("\u0001");
  if (state.playersKey !== key) {
    state.playersKey = key;
    state.playerSideBag = [];
  }

  if (!state.playerSideBag.length) {
    state.playerSideBag = shuffle(players.map((p) => p.side));
    if (state.lastPlayerSide && state.playerSideBag[0] === state.lastPlayerSide) {
      const swapIndex = state.playerSideBag.findIndex((s) => s !== state.lastPlayerSide);
      if (swapIndex > 0) {
        [state.playerSideBag[0], state.playerSideBag[swapIndex]] = [
          state.playerSideBag[swapIndex],
          state.playerSideBag[0],
        ];
      }
    }
  }

  const side = state.playerSideBag.shift();
  const player = players.find((p) => p.side === side) || players[0];
  state.lastPlayerSide = player.side;
  return player;
}

function drawOnce() {
  const deck = parseDeck(state.deckText);
  if (!deck.length) return { ok: false, message: "题库为空，请先在下方输入题目（每行一题）。" };
  const players = currentPlayers();
  const player = nextPlayer(players);
  const text = pickRandom(deck);
  if (!text) return { ok: false, message: "题库为空，请先在下方输入题目（每行一题）。" };
  return { ok: true, player, text };
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

function showDraw(result) {
  if (!result.ok) {
    els.who.textContent = "未指定玩家";
    els.prompt.textContent = result.message;
    setCopyEnabled(false);
    state.lastDraw = null;
    return;
  }
  els.who.textContent = labelForDrawPlayer(result.player);
  els.prompt.textContent = result.text;
  setCopyEnabled(true);
  state.lastDraw = result;
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
  const msg = { side: state.selfSide, text, ts: Date.now() };
  state.chat = [...(Array.isArray(state.chat) ? state.chat : []), msg].slice(-200);
  saveJson(STORAGE_KEYS.chat, state.chat);
  els.chatInput.value = "";
  autoSizeChatInput();
  renderChat();
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
    state.playerSideBag = [];
    updateSelfButtons();
  });
  els.playerB.addEventListener("input", () => {
    state.playerB = els.playerB.value;
    saveText(STORAGE_KEYS.playerB, state.playerB);
    state.playerSideBag = [];
    updateSelfButtons();
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
  });

  els.clearDeckBtn.addEventListener("click", () => {
    state.deckText = "";
    els.deckInput.value = "";
    saveText(STORAGE_KEYS.deckText, state.deckText);
    renderDeckCount();
    showDraw({ ok: false, message: "题库已清空，请先在下方输入题目（每行一题）。" });
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
  });
}

function hydrateUI() {
  els.playerA.value = state.playerA;
  els.playerB.value = state.playerB;
  els.deckInput.value = state.deckText;
  renderDeckCount();
  setCopyEnabled(false);
  updateSelfButtons();
  renderChat();
  autoSizeChatInput();
}

bindEvents();
hydrateUI();
