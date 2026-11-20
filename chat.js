"use strict";

const DEFAULTS = {
  twitchChannel: "mon_official",
  // MON main channel (more can be added comma-separated in settings)
  youtubeChannel: "UCVsSnnJ8fL5PwOokVLsbAMw",
  fontSize: 15,
  showHost: false, // streamer's own messages hidden by default
  showMod: false,  // moderator messages hidden by default
  showBot: false,  // bot messages hidden by default
  botNames: "nightbot, streamelements, streamlabs, moobot, fossabot, wizebot, botrix, sery_bot, " +
    "soundalerts, kofistreambot, pokemoncommunitygame, commanderroot, streamstickers, own3d, deepbot, phantombot"
};

let botSet = new Set();
function updateBotSet() {
  botSet = new Set(settings.botNames.split(/[\s,;]+/).map((n) => n.replace(/^@/, "").toLowerCase()).filter(Boolean));
}
const MAX_MESSAGES = 400;
const YT_RECHECK_MS = 60_000; // how often to look for a new live stream when offline

let settings = { ...DEFAULTS };

/* =====================================================================
 * UI: feed, pinning, auto-scroll
 * ===================================================================== */
const feed = document.getElementById("feed");
const pinsEl = document.getElementById("pins");
const jumpBtn = document.getElementById("jump");
let stickToBottom = true;
const msgIndex = new Map(); // id -> element (for dedupe + deletions)

feed.addEventListener("scroll", () => {
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  stickToBottom = atBottom;
  if (atBottom) jumpBtn.hidden = true;
});
jumpBtn.addEventListener("click", () => {
  stickToBottom = true;
  feed.scrollTop = feed.scrollHeight;
  jumpBtn.hidden = true;
});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * msg = {
 *   id, platform: "yt"|"tw", author, color, roles: [{cls,label}],
 *   parts: [{text}|{emote:url, alt}|{link:url, text}], amount?, kind?: "paid"|"highlight"|"system"
 * }
 */
function addMessage(msg) {
  if (msg.id && msgIndex.has(msg.id)) return;
  if (msg.kind !== "system") msg.parts = applyThirdPartyEmotes(msg.parts);

  const row = el("div", `msg ${msg.platform}`);
  if (msg.kind) row.classList.add(msg.kind);
  if (msg.roles?.some((r) => r.cls === "owner")) row.classList.add("host");
  if (msg.roles?.some((r) => r.cls === "mod")) row.classList.add("mod");
  if (msg.author && botSet.has(msg.author.replace(/^@/, "").toLowerCase())) row.classList.add("bot");
  row.append(renderMessageBody(msg));

  if (msg.kind !== "system") {
    row.title = "Click to pin";
    row.addEventListener("click", () => pinMessage(msg, row));
  }

  feed.append(row);
  if (msg.id) msgIndex.set(msg.id, row);

  while (feed.children.length > MAX_MESSAGES) {
    const first = feed.firstElementChild;
    for (const [k, v] of msgIndex) if (v === first) { msgIndex.delete(k); break; }
    first.remove();
  }

  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
  else jumpBtn.hidden = false;
}

function renderMessageBody(msg) {
  const frag = document.createDocumentFragment();
  frag.append(el("span", `badge badge-${msg.platform}`, msg.platform.toUpperCase()));
  for (const r of msg.roles || []) frag.append(el("span", `role ${r.cls}`, r.label));
  if (msg.author) {
    const a = el("span", "author", msg.author);
    if (msg.color) a.style.color = msg.color;
    frag.append(a);
  }
  if (msg.amount) frag.append(el("span", "amount", msg.amount));
  const text = el("span", "text");
  for (const p of msg.parts || []) {
    if (p.emote) {
      const img = el("img", "emote");
      img.src = p.emote;
      img.alt = p.alt || "";
      img.title = p.provider ? `${p.alt} (${p.provider})` : p.alt || "";
      img.loading = "lazy";
      // zero-width emotes (e.g. 7TV hats, BTTV SoSnowy) sit on top of the previous emote
      let prev = text.lastChild;
      if (p.zeroWidth && prev?.nodeType === Node.TEXT_NODE && !prev.textContent.trim() &&
          prev.previousSibling?.classList?.contains("emote-stack")) {
        const space = prev;
        prev = prev.previousSibling;
        space.remove(); // "catJAM RainTime" -> RainTime sits on catJAM
      }
      if (p.zeroWidth && prev?.classList?.contains("emote-stack")) {
        img.classList.add("zw");
        prev.append(img);
      } else {
        const stack = el("span", "emote-stack");
        stack.append(img);
        text.append(stack);
      }
    } else if (p.link) {
      const a = el("a", null, p.text);
      a.href = p.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.addEventListener("click", (e) => e.stopPropagation());
      text.append(a);
    } else {
      text.append(document.createTextNode(p.text));
    }
  }
  frag.append(text);
  return frag;
}

// ---- single pin with zoom + spotlight ----
let pinned = null; // { msg, row }
let pinZoom = 1.3;
const ZOOM_MIN = 0.8, ZOOM_MAX = 6, ZOOM_STEP = 0.15;

function pinMessage(msg, row) {
  const same = pinned && msg.id && pinned.msg.id === msg.id;
  unpin();
  if (same) return; // clicking the pinned message again unpins it

  pinned = { msg, row };
  row.classList.add("pinned");

  const pin = el("div", "pin");
  const body = el("div", "pin-body");
  body.append(renderMessageBody(msg));

  const tools = el("div", "pin-tools");
  const btn = (label, title, fn) => {
    const b = el("button", null, label);
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    tools.append(b);
    return b;
  };
  btn("−", "Smaller (Ctrl+wheel / -)", () => setPinZoom(pinZoom - ZOOM_STEP));
  const pct = el("span", "pin-zoom");
  tools.append(pct);
  btn("+", "Bigger (Ctrl+wheel / +)", () => setPinZoom(pinZoom + ZOOM_STEP));
  btn("⛶", "Spotlight: fill the window (F)", toggleSpotlight);
  btn("×", "Unpin (Esc)", unpin);

  pin.append(body, tools);
  pin.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setPinZoom(pinZoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });
  pin.addEventListener("dblclick", toggleSpotlight);

  pinsEl.append(pin);
  setPinZoom(pinZoom);
}

function unpin() {
  if (!pinned) return;
  pinned.row.classList.remove("pinned");
  pinned = null;
  pinsEl.textContent = "";
  document.body.classList.remove("spotlight");
}

function setPinZoom(z) {
  pinZoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
  document.documentElement.style.setProperty("--pin-zoom", pinZoom);
  const pct = pinsEl.querySelector(".pin-zoom");
  if (pct) pct.textContent = Math.round(pinZoom * 100) + "%";
  chrome.storage.local.set({ pinZoom });
}

function toggleSpotlight() {
  if (pinned) document.body.classList.toggle("spotlight");
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input")) return;
  if (e.key === "Escape") {
    if (document.body.classList.contains("spotlight")) document.body.classList.remove("spotlight");
    else unpin();
  } else if (pinned && (e.key === "+" || e.key === "=")) setPinZoom(pinZoom + ZOOM_STEP);
  else if (pinned && e.key === "-") setPinZoom(pinZoom - ZOOM_STEP);
  else if (e.key === "f" || e.key === "F") toggleSpotlight();
});

function markDeleted(id) {
  msgIndex.get(id)?.classList.add("deleted");
}

function system(platform, text) {
  addMessage({ platform, kind: "system", parts: [{ text }] });
}

function setStatus(platform, state, label, href) {
  const s = document.getElementById(`st-${platform}`);
  s.classList.toggle("live", state === "live");
  s.classList.toggle("error", state === "error");
  const l = s.querySelector(".label");
  l.textContent = "";
  if (href) {
    const a = el("a", null, label);
    a.href = href;
    a.target = "_blank";
    l.append(a);
  } else {
    l.textContent = label;
  }
  l.title = label;
}

/* =====================================================================
 * Twitch: anonymous IRC over WebSocket
 * ===================================================================== */
const twitch = {
  ws: null,
  channel: null,
  retry: 0,
  closedOnPurpose: false,

  connect(channel) {
    this.disconnect();
    this.channel = channel.toLowerCase().replace(/^#/, "").trim();
    if (!this.channel) return setStatus("tw", "error", "no channel");
    this.closedOnPurpose = false;
    setStatus("tw", "", `connecting #${this.channel}…`);

    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;
    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      ws.send(`JOIN #${this.channel}`);
    };
    ws.onmessage = (ev) => {
      for (const line of ev.data.split("\r\n")) if (line) this.handle(line);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closedOnPurpose) return;
      setStatus("tw", "error", "disconnected – retrying");
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => { if (this.ws === ws) this.connect(this.channel); }, delay);
    };
  },

  disconnect() {
    this.closedOnPurpose = true;
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
  },

  handle(line) {
    const m = parseIrc(line);
    switch (m.command) {
      case "PING":
        this.ws.send(`PONG :${m.trailing || "tmi.twitch.tv"}`);
        break;
      case "RECONNECT":
        this.connect(this.channel);
        break;
      case "ROOMSTATE":
        if (m.tags["room-id"]) loadChannelEmotes(m.tags["room-id"]);
        break;
      case "366": // end of NAMES = joined
        if (m.command === "366") {
          this.retry = 0;
          setStatus("tw", "live", `#${this.channel}`, `https://www.twitch.tv/${this.channel}`);
        }
        break;
      case "PRIVMSG":
        addMessage(twitchToMsg(m));
        break;
      case "USERNOTICE": {
        // subs, resubs, gift subs, raids...
        const sysText = m.tags["system-msg"];
        if (sysText) {
          const msg = twitchToMsg(m);
          msg.kind = "highlight";
          msg.parts = [{ text: sysText + (m.trailing ? " — " : "") }, ...(m.trailing ? msg.parts : [])];
          msg.author = null;
          addMessage(msg);
        }
        break;
      }
      case "CLEARMSG":
        markDeleted("tw:" + m.tags["target-msg-id"]);
        break;
      case "CLEARCHAT": {
        // user timed out / banned -> strike through their messages
        const uid = m.tags["target-user-id"];
        if (uid) for (const [id, row] of msgIndex) if (row.dataset.uid === uid) markDeleted(id);
        break;
      }
      case "NOTICE":
        if (m.trailing) system("tw", m.trailing);
        break;
    }
  }
};

function parseIrc(line) {
  const out = { tags: {}, prefix: "", command: "", params: [], trailing: "" };
  let rest = line;
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    for (const kv of rest.slice(1, sp).split(";")) {
      const eq = kv.indexOf("=");
      const k = eq < 0 ? kv : kv.slice(0, eq);
      const v = eq < 0 ? "" : kv.slice(eq + 1);
      out.tags[k] = v.replace(/\\(.)/g, (_, c) => ({ s: " ", ":": ";", "\\": "\\", r: "\r", n: "\n" }[c] ?? c));
    }
    rest = rest.slice(sp + 1);
  }
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    out.prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const t = rest.indexOf(" :");
  if (t >= 0) {
    out.trailing = rest.slice(t + 2);
    rest = rest.slice(0, t);
  }
  const parts = rest.split(" ");
  out.command = parts.shift();
  out.params = parts;
  return out;
}

const TW_ROLE = {
  broadcaster: { cls: "owner", label: "HOST" },
  moderator: { cls: "mod", label: "MOD" },
  vip: { cls: "vip", label: "VIP" },
  subscriber: { cls: "member", label: "SUB" }
};

function twitchToMsg(m) {
  const tags = m.tags;
  let text = m.trailing || "";
  let isAction = false;
  const action = text.match(/^\u0001ACTION (.*)\u0001$/);
  if (action) { text = action[1]; isAction = true; }

  // Twitch emote positions are in Unicode code points
  const chars = Array.from(text);
  const ranges = [];
  if (tags.emotes) {
    for (const group of tags.emotes.split("/")) {
      const [id, pos] = group.split(":");
      if (!pos) continue;
      for (const r of pos.split(",")) {
        const [s, e] = r.split("-").map(Number);
        ranges.push({ s, e, id });
      }
    }
    ranges.sort((a, b) => a.s - b.s);
  }
  const parts = [];
  let i = 0;
  for (const r of ranges) {
    if (r.s > i) parts.push(...linkify(chars.slice(i, r.s).join("")));
    const name = chars.slice(r.s, r.e + 1).join("");
    parts.push({ emote: `https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/2.0`, alt: name });
    i = r.e + 1;
  }
  if (i < chars.length) parts.push(...linkify(chars.slice(i).join("")));

  const roles = [];
  for (const b of (tags.badges || "").split(",")) {
    const role = TW_ROLE[b.split("/")[0]];
    if (role) roles.push(role);
  }

  const msg = {
    id: tags.id ? "tw:" + tags.id : null,
    platform: "tw",
    author: tags["display-name"] || m.prefix.split("!")[0],
    color: tags.color || "#b983ff",
    roles,
    parts,
    kind: tags["msg-id"] === "highlighted-message" || tags["first-msg"] === "1" ? "highlight"
      : tags.bits ? "paid" : undefined,
    amount: tags.bits ? `${tags.bits} bits` : undefined
  };
  // remember user id so CLEARCHAT can strike their messages
  queueMicrotask(() => { const row = msgIndex.get(msg.id); if (row) row.dataset.uid = tags["user-id"] || ""; });
  return msg;
}

/* =====================================================================
 * Third-party emotes: 7TV + BTTV (global + the Twitch channel's set).
 * Applied to Twitch AND YouTube messages, like a shared channel chat.
 * ===================================================================== */
const emotes = { global: new Map(), channel: new Map() }; // code -> { url, provider, zeroWidth }
let channelEmotesFor = null;

// BTTV's classic overlay emotes (it has no flag for these)
const BTTV_ZERO_WIDTH = new Set(["SoSnowy", "IceCold", "SantaHat", "TopHat", "ReinDeer", "CandyCane", "cvMask", "cvHazmat"]);

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function add7tv(map, list) {
  for (const e of list || []) {
    const host = e.data?.host;
    if (!host?.url) continue;
    const file = host.files?.find((f) => f.name === "2x.webp") || host.files?.[0];
    map.set(e.name, {
      url: "https:" + host.url + "/" + (file?.name || "2x.webp"),
      provider: "7TV",
      zeroWidth: Boolean((e.flags & 1) || (e.data.flags & 256))
    });
  }
}

function addBttv(map, list) {
  for (const e of list || []) {
    if (e.modifier) continue; // w!, h!, etc. – text modifiers, not images
    map.set(e.code, {
      url: `https://cdn.betterttv.net/emote/${e.id}/2x.webp`,
      provider: "BTTV",
      zeroWidth: BTTV_ZERO_WIDTH.has(e.code)
    });
  }
}

async function loadGlobalEmotes() {
  const [stv, bttv] = await Promise.allSettled([
    getJson("https://7tv.io/v3/emote-sets/global"),
    getJson("https://api.betterttv.net/3/cached/emotes/global")
  ]);
  // BTTV first, 7TV second (7TV wins on name clashes, like Chatterino)
  if (bttv.status === "fulfilled") addBttv(emotes.global, bttv.value);
  if (stv.status === "fulfilled") add7tv(emotes.global, stv.value.emotes);
  console.log(`[emotes] global: ${emotes.global.size}`);
}

async function loadChannelEmotes(twitchUserId) {
  if (channelEmotesFor === twitchUserId) return;
  channelEmotesFor = twitchUserId;
  const map = new Map();
  const [stv, bttv] = await Promise.allSettled([
    getJson(`https://7tv.io/v3/users/twitch/${twitchUserId}`), // 404 if the channel has no 7TV account
    getJson(`https://api.betterttv.net/3/cached/users/twitch/${twitchUserId}`)
  ]);
  if (bttv.status === "fulfilled") addBttv(map, [...(bttv.value.channelEmotes || []), ...(bttv.value.sharedEmotes || [])]);
  if (stv.status === "fulfilled") add7tv(map, stv.value.emote_set?.emotes);
  emotes.channel = map;
  console.log(`[emotes] channel ${twitchUserId}: ${map.size}`);
}

function applyThirdPartyEmotes(parts) {
  if (!emotes.global.size && !emotes.channel.size) return parts || [];
  const out = [];
  for (const p of parts || []) {
    if (p.emote || p.link || !p.text) { out.push(p); continue; }
    let buf = "";
    for (const tok of p.text.split(/(\s+)/)) {
      const e = emotes.channel.get(tok) || emotes.global.get(tok);
      if (e) {
        if (buf) { out.push({ text: buf }); buf = ""; }
        out.push({ emote: e.url, alt: tok, provider: e.provider, zeroWidth: e.zeroWidth });
      } else {
        buf += tok;
      }
    }
    if (buf) out.push({ text: buf });
  }
  return out;
}

function linkify(str) {
  const out = [];
  const re = /\bhttps?:\/\/[^\s]+/gi;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ text: str.slice(last, m.index) });
    out.push({ link: m[0], text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ text: str.slice(last) });
  return out;
}

/* =====================================================================
 * YouTube: find current live stream, then poll the live chat API
 * ===================================================================== */
function makeYouTube(channel) { return {
  channel,
  state: "", label: "", href: "",
  status(state, label, href) { Object.assign(this, { state, label, href }); renderYtStatus(); },
  session: 0, // bump to cancel running loops
  timer: null,

  async start(channel) {
    this.stop();
    const session = this.session;
    channel = channel.trim();
    if (!channel) return this.status("error", "no channel");

    const base = channel.startsWith("@") ? `https://www.youtube.com/${channel}`
      : channel.startsWith("http") ? channel.replace(/\/+$/, "")
      : `https://www.youtube.com/channel/${channel}`;

    this.status("", "looking for stream…");
    try {
      const live = await this.findLiveVideo(base);
      if (session !== this.session) return;
      if (!live) {
        this.status("", "offline – checking every min", base);
        this.timer = setTimeout(() => this.start(channel), YT_RECHECK_MS);
        return;
      }
      this.status("", `${live.upcoming ? "upcoming" : "live"}: loading chat…`);
      await this.runChat(live.videoId, session);
    } catch (err) {
      if (session !== this.session) return;
      console.error("[YT]", err);
      system("yt", `YouTube error: ${err.message} – retrying in 15s`);
      this.status("error", "error – retrying", base);
    }
    // chat ended or failed -> look again later
    if (session === this.session) this.timer = setTimeout(() => this.start(channel), 15_000);
  },

  stop() {
    this.session++;
    clearTimeout(this.timer);
  },

  async findLiveVideo(base) {
    const res = await fetch(`${base}/live`, { credentials: "include" });
    const html = await res.text();
    const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    if (!canonical) return null;
    const isLive = /"isLiveNow":true|"isLive":true/.test(html);
    const upcoming = /"isUpcoming":true/.test(html);
    if (!isLive && !upcoming) return null;
    return { videoId: canonical[1], upcoming: upcoming && !isLive };
  },

  async runChat(videoId, session) {
    await stripExtensionOrigin();
    // Load the chat page logged-out first, so the continuation token matches the
    // logged-out polling requests. Fall back to cookies (e.g. EU consent wall).
    const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`;
    let html = await (await fetch(chatUrl, { credentials: "omit" })).text();
    let data = extractJson(html, "ytInitialData");
    if (!data?.contents?.liveChatRenderer) {
      console.log("[YT] logged-out chat page unusable, retrying with cookies");
      html = await (await fetch(chatUrl, { credentials: "include" })).text();
      data = extractJson(html, "ytInitialData");
    }
    if (!data) throw new Error("ytInitialData not found on live_chat page");
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1] || "2.20241101.00.00";

    const lcr = data?.contents?.liveChatRenderer;
    if (!lcr) {
      throw new Error("Chat is disabled or not available for this stream");
    }

    // Prefer "Live chat" (all messages) over "Top chat"
    const subMenu = lcr.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
    let continuation =
      subMenu?.[1]?.continuation?.reloadContinuationData?.continuation ||
      getContinuation(lcr.continuations);

    this.status("live", this.channel, `https://www.youtube.com/watch?v=${videoId}`);
    system("yt", `Connected to YouTube live chat (${this.channel}).`);

    const endpoint = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false" +
      (apiKey ? `&key=${apiKey}` : "");
    let failures = 0;
    let first = true;

    while (session === this.session && continuation) {
      let json;
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion, hl: "en" } },
            continuation
          })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        json = await r.json();
        failures = 0;
      } catch (err) {
        console.warn("[YT] poll failed", err);
        if (failures === 0) system("yt", `YouTube poll failed: ${err.message} – retrying…`);
        if (++failures > 5) throw err;
        await sleep(3000 * failures);
        continue;
      }
      if (session !== this.session) return;

      const lc = json?.continuationContents?.liveChatContinuation;
      if (!lc) { console.warn("[YT] no liveChatContinuation", json); break; } // stream ended

      // When we switch to "Live chat" the first batch is the backlog; only keep the last 30.
      let actions = lc.actions || [];
      if (first) console.log(`[YT] first poll OK, ${actions.length} backlog actions`);
      if (first) { actions = actions.slice(-30); first = false; }
      for (const a of actions) handleYtAction(a);

      const next = lc.continuations?.[0];
      const cd = next?.invalidationContinuationData || next?.timedContinuationData || next?.reloadContinuationData;
      continuation = cd?.continuation;
      await sleep(Math.max(1000, Math.min(cd?.timeoutMs ?? 3000, 5000)));
    }

    if (session === this.session) {
      this.status("", "stream ended");
      system("yt", "YouTube stream / chat ended.");
    }
  }
}; }

// One watcher per YouTube channel (MON streams on several). The header shows a combined status.
let ytWatchers = [];
function startYouTube(list) {
  for (const w of ytWatchers) w.stop();
  ytWatchers = list.split(/[\s,;]+/).filter(Boolean).map((c) => makeYouTube(c));
  for (const w of ytWatchers) w.start(w.channel);
  renderYtStatus();
}
function renderYtStatus() {
  const live = ytWatchers.filter((w) => w.state === "live");
  if (live.length === 1) return setStatus("yt", "live", ytWatchers.length > 1 ? `▶ ${live[0].channel}` : "▶ live", live[0].href);
  if (live.length > 1) return setStatus("yt", "live", `${live.length} live: ${live.map((w) => w.channel).join(", ")}`);
  const err = ytWatchers.find((w) => w.state === "error");
  if (err) return setStatus("yt", "error", `${err.channel}: ${err.label}`);
  setStatus("yt", "", ytWatchers.length ? "offline – checking every min" : "no channel");
}

// Requests from an extension page carry "Origin: chrome-extension://…", which YouTube's
// API may reject. Drop that header for this extension's own calls to the chat API only.
async function stripExtensionOrigin() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: {
          urlFilter: "||youtube.com/youtubei/",
          initiatorDomains: [location.host], // extension id in Chrome, internal UUID in Firefox
          resourceTypes: ["xmlhttprequest"]
        }
      }]
    });
  } catch (err) {
    console.warn("[YT] could not install header rule", err);
  }
}

function getContinuation(conts) {
  const c = conts?.[0];
  return (c?.invalidationContinuationData || c?.timedContinuationData || c?.reloadContinuationData)?.continuation;
}

function extractJson(html, varName) {
  const re = new RegExp(`(?:window\\["${varName}"\\]|var ${varName}|${varName})\\s*=\\s*`);
  const m = re.exec(html);
  if (!m) return null;
  // walk braces to find the end of the object literal
  let i = m.index + m[0].length, depth = 0, inStr = false, esc = false;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
}

function handleYtAction(a) {
  const item = a.addChatItemAction?.item;
  if (a.markChatItemAsDeletedAction) {
    markDeleted("yt:" + a.markChatItemAsDeletedAction.targetItemId);
    return;
  }
  if (a.markChatItemsByAuthorAsDeletedAction) {
    // banned user: nothing to match on reliably except channel id
    const ch = a.markChatItemsByAuthorAsDeletedAction.externalChannelId;
    for (const [id, row] of msgIndex) if (row.dataset.uid === ch) markDeleted(id);
    return;
  }
  if (!item) return;

  const type = Object.keys(item)[0];
  const r = item[type];
  const msg = {
    id: "yt:" + r.id,
    platform: "yt",
    author: r.authorName?.simpleText || "",
    color: "#ff8a8a",
    roles: ytRoles(r.authorBadges),
    parts: ytRuns(r.message?.runs)
  };

  switch (type) {
    case "liveChatTextMessageRenderer":
      break;
    case "liveChatPaidMessageRenderer":
      msg.kind = "paid";
      msg.amount = r.purchaseAmountText?.simpleText;
      break;
    case "liveChatPaidStickerRenderer":
      msg.kind = "paid";
      msg.amount = r.purchaseAmountText?.simpleText;
      msg.parts = [{ text: "(Super Sticker)" }];
      break;
    case "liveChatMembershipItemRenderer":
      msg.kind = "highlight";
      msg.parts = [...ytRuns(r.headerSubtext?.runs || (r.headerSubtext?.simpleText ? [{ text: r.headerSubtext.simpleText }] : [])),
        ...(msg.parts.length ? [{ text: " — " }, ...msg.parts] : [])];
      break;
    case "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer": {
      const h = r.header?.liveChatSponsorshipsHeaderRenderer;
      msg.kind = "highlight";
      msg.author = h?.authorName?.simpleText || "";
      msg.parts = ytRuns(h?.primaryText?.runs);
      break;
    }
    default:
      return; // ignore viewer engagement messages, placeholders, etc.
  }
  if (r.authorBadges?.some((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType === "OWNER")) msg.color = "#ffd600";
  addMessage(msg);
  const row = msgIndex.get(msg.id);
  if (row && r.authorExternalChannelId) row.dataset.uid = r.authorExternalChannelId;
}

function ytRoles(badges) {
  const roles = [];
  for (const b of badges || []) {
    const br = b.liveChatAuthorBadgeRenderer;
    const icon = br?.icon?.iconType;
    if (icon === "OWNER") roles.push({ cls: "owner", label: "HOST" });
    else if (icon === "MODERATOR") roles.push({ cls: "mod", label: "MOD" });
    else if (br?.customThumbnail) roles.push({ cls: "member", label: "MEMBER" });
  }
  return roles;
}

function ytRuns(runs) {
  const parts = [];
  for (const run of runs || []) {
    if (run.emoji) {
      const thumbs = run.emoji.image?.thumbnails || [];
      const url = thumbs[thumbs.length - 1]?.url;
      const alt = run.emoji.shortcuts?.[0] || run.emoji.emojiId || "";
      // standard unicode emoji: render as text, custom channel emoji: as image
      if (!run.emoji.isCustomEmoji && run.emoji.emojiId && !run.emoji.emojiId.includes("/")) parts.push({ text: run.emoji.emojiId });
      else if (url) parts.push({ emote: url.startsWith("//") ? "https:" + url : url, alt });
      else parts.push({ text: alt });
    } else if (run.navigationEndpoint?.urlEndpoint?.url) {
      let url = run.navigationEndpoint.urlEndpoint.url;
      try { // unwrap youtube redirect links
        const u = new URL(url, "https://www.youtube.com");
        url = u.searchParams.get("q") || u.href;
      } catch {}
      parts.push({ link: url, text: run.text });
    } else if (run.text != null) {
      parts.push({ text: run.text });
    }
  }
  return parts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =====================================================================
 * Settings + filters
 * ===================================================================== */
const settingsEl = document.getElementById("settings");
const inTwitch = document.getElementById("set-twitch");
const inYt = document.getElementById("set-yt");
const inFont = document.getElementById("set-font");
const inBots = document.getElementById("set-bots");

document.getElementById("open-settings").addEventListener("click", () => {
  inTwitch.value = settings.twitchChannel;
  inYt.value = settings.youtubeChannel;
  inBots.value = settings.botNames;
  inFont.value = settings.fontSize;
  settingsEl.hidden = !settingsEl.hidden;
});
document.getElementById("close-settings").addEventListener("click", () => (settingsEl.hidden = true));
inFont.addEventListener("input", () => applyFont(inFont.value));
document.getElementById("save-settings").addEventListener("click", async () => {
  const next = {
    ...settings,
    twitchChannel: inTwitch.value.trim() || DEFAULTS.twitchChannel,
    youtubeChannel: inYt.value.trim() || DEFAULTS.youtubeChannel,
    fontSize: Number(inFont.value) || DEFAULTS.fontSize,
    botNames: inBots.value.trim()
  };
  const twChanged = next.twitchChannel !== settings.twitchChannel;
  const ytChanged = next.youtubeChannel !== settings.youtubeChannel;
  settings = next;
  updateBotSet();
  // re-tag messages already in the feed with the new bot list
  for (const row of feed.children) {
    const name = row.querySelector(".author")?.textContent.replace(/^@/, "").toLowerCase();
    if (name) row.classList.toggle("bot", botSet.has(name));
  }
  await chrome.storage.local.set(settings);
  settingsEl.hidden = true;
  if (twChanged) twitch.connect(settings.twitchChannel);
  if (ytChanged) startYouTube(settings.youtubeChannel);
});

function applyFont(px) {
  document.documentElement.style.setProperty("--font-size", px + "px");
}

// YT/TW are header buttons that reset each session.
// HOST/MOD/BOT are checkboxes in the 👁 menu and are remembered.
const PERSISTED_FILTER = { host: "showHost", mod: "showMod", bot: "showBot" };

function setFilter(p, on) {
  const ctl = document.getElementById(`filter-${p}`);
  if (ctl.type === "checkbox") ctl.checked = on;
  else ctl.classList.toggle("on", on);
  document.body.classList.toggle(`hide-${p}`, !on);
  const hidden = Object.keys(PERSISTED_FILTER).filter((k) => document.body.classList.contains(`hide-${k}`)).length;
  document.getElementById("hidden-count").textContent = hidden ? String(hidden) : "";
  if (stickToBottom) feed.scrollTop = feed.scrollHeight;
}

for (const p of ["yt", "tw"]) {
  const btn = document.getElementById(`filter-${p}`);
  btn.addEventListener("click", () => setFilter(p, !btn.classList.contains("on")));
}
for (const [p, key] of Object.entries(PERSISTED_FILTER)) {
  const box = document.getElementById(`filter-${p}`);
  box.addEventListener("change", () => {
    setFilter(p, box.checked);
    settings[key] = box.checked;
    chrome.storage.local.set({ [key]: box.checked });
  });
}

const filterMenu = document.getElementById("filter-menu");
document.getElementById("filter-menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  filterMenu.hidden = !filterMenu.hidden;
});
document.addEventListener("click", (e) => {
  if (!filterMenu.hidden && !e.target.closest(".menu-wrap")) filterMenu.hidden = true;
});

/* =====================================================================
 * Boot
 * ===================================================================== */
chrome.storage.local.get({ ...DEFAULTS, pinZoom: null }, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  applyFont(settings.fontSize);
  if (typeof stored.pinZoom === "number") pinZoom = stored.pinZoom;
  delete settings.pinZoom;
  updateBotSet();
  loadGlobalEmotes();
  setFilter("host", settings.showHost);
  setFilter("mod", settings.showMod);
  setFilter("bot", settings.showBot);
  twitch.connect(settings.twitchChannel);
  startYouTube(settings.youtubeChannel);
});
