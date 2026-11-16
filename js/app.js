// VibeFlow MVP: Audius search + playback, queue, AI Radio. Guest mode (localStorage).
const $ = s => document.querySelector(s), audio = $("#audio");
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("vf_" + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("vf_" + k, JSON.stringify(v)); } catch {} } };
const S = { queue: store.get("queue", []), idx: store.get("idx", -1), favs: store.get("favs", []), hist: store.get("hist", []), radio: false, shuffle: false, repeat: false, view: "discover", results: [], recs: [], busy: false, diag: null };
const save = () => { store.set("queue", S.queue); store.set("idx", S.idx); store.set("favs", S.favs); store.set("hist", S.hist); };
const toast = m => { const t = $("#toast"); t.textContent = m; t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = "none", 3500); };
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(fn, opts) {
  const r = await fetch("/.netlify/functions/" + fn, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed (" + r.status + ")");
  return d;
}
const cur = () => S.queue[S.idx];

// ---- Playback: one <audio> element, so two tracks can never play at once ----
async function playIndex(i) {
  const t = S.queue[i]; if (!t) return;
  S.idx = i; audio.pause(); render(); save();
  try {
    const { url } = await api("audius-stream?id=" + encodeURIComponent(t.id));
    if (cur()?.id !== t.id) return;
    audio.src = url;
    await audio.play();
    S.hist = [t, ...S.hist.filter(x => x.id !== t.id)].slice(0, 50); save();
    suggest();
  } catch (e) {
    if (e.name === "NotAllowedError") toast("Your browser blocked autoplay. Press play.");
    else if (e.name !== "AbortError") { toast("Can't play “" + t.title + "”: " + e.message + " Skipping."); setTimeout(next, 1200); }
  }
  render();
}
function next() {
  if (!S.queue.length) return;
  let i = S.repeat ? S.idx : S.shuffle ? Math.floor(Math.random() * S.queue.length) : S.idx + 1;
  if (i >= S.queue.length) {
    if (S.radio && S.recs[0]) { addQueue(S.recs[0]); i = S.queue.length - 1; } else { audio.pause(); return render(); }
  }
  playIndex(i);
}
const prev = () => audio.currentTime > 4 ? (audio.currentTime = 0) : playIndex(Math.max(0, S.idx - 1));

// ---- Queue ----
function addQueue(t, mode = "end") {
  const { score, reason, transition, ...track } = t;
  if (mode === "next") S.queue.splice(S.idx + 1, 0, track); else S.queue.push(track);
  save(); render();
}
function playNow(t) { addQueue(t, "next"); playIndex(S.idx + 1); }
function remove(i) { S.queue.splice(i, 1); if (i < S.idx) S.idx--; else if (i === S.idx) { audio.pause(); S.idx = -1; } save(); render(); }
function move(i, d) { const j = i + d; if (j < 0 || j >= S.queue.length) return; [S.queue[i], S.queue[j]] = [S.queue[j], S.queue[i]]; if (S.idx === i) S.idx = j; else if (S.idx === j) S.idx = i; save(); render(); }
function fav(t) { const has = S.favs.some(f => f.id === t.id); S.favs = has ? S.favs.filter(f => f.id !== t.id) : [t, ...S.favs]; save(); render(); }

// ---- AI DJ: gathers real Audius candidates; the AI only ranks them ----
async function suggest() {
  const t = cur(); if (!t || S.busy) return; S.busy = true;
  try {
    const seeds = [t.artist, t.genre].filter(Boolean);
    const lists = await Promise.all([...seeds.map(q => api("audius-search?q=" + encodeURIComponent(q)).catch(() => ({ tracks: [] }))), api("audius-search?mode=trending").catch(() => ({ tracks: [] }))]);
    const seen = new Set([t.id, ...S.hist.slice(0, 10).map(x => x.id)]);
    const candidates = lists.flatMap(l => l.tracks).filter(x => !seen.has(x.id) && seen.add(x.id));
    const likes = [...new Set(S.favs.flatMap(f => [f.artist, f.genre]).filter(Boolean))];
    const d = await api("ai-recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: t, recent: S.hist.slice(0, 10), likes, candidates }) });
    S.recs = d.recommendations;
    $("#why").textContent = S.recs[0] ? `Up next: ${S.recs[0].title} (${S.recs[0].score}% match). ${S.recs[0].reason}` : "";
    if (S.radio && S.idx >= S.queue.length - 1 && S.recs[0]) addQueue(S.recs[0]);
  } catch (e) { toast("AI suggestions unavailable: " + e.message); }
  S.busy = false; render();
}

// ---- Views ----
const TITLES = { discover: "Trending on Audius", radio: "AI Radio", search: "Search results", favs: "Favourites", history: "Recently played", diag: "Diagnostics" };
async function load(view) {
  S.view = view; $("#vh").textContent = TITLES[view];
  document.querySelectorAll(".side button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  if (view === "discover" || view === "radio") { try { S.results = (await api("audius-search?mode=trending")).tracks; } catch (e) { S.results = []; toast(e.message); } }
  if (view === "radio" && !S.radio) toggleRadio();
  if (view === "diag") { try { S.diag = await api("health-check"); } catch (e) { S.diag = { error: e.message }; } }
  render();
}
async function search(q) {
  S.view = "search"; $("#vh").textContent = TITLES.search;
  try { S.results = (await api("audius-search?q=" + encodeURIComponent(q))).tracks; if (!S.results.length) toast("No tracks found for “" + q + "”."); } catch (e) { S.results = []; toast(e.message); }
  render();
}
async function toggleRadio() {
  S.radio = !S.radio; $("#radio").textContent = "AI Radio: " + (S.radio ? "on" : "off");
  if (!S.radio) return;
  if (!cur()) { try { const tr = (await api("audius-search?mode=trending")).tracks; if (tr[0]) { addQueue(tr[0]); playIndex(S.queue.length - 1); } } catch (e) { toast(e.message); } }
  else suggest();
}

function row(t, kind, i) {
  const isFav = S.favs.some(f => f.id === t.id), c = kind === "q" && i === S.idx ? " cur" : "";
  const acts = kind === "q"
    ? `<button data-a="up" data-i="${i}" aria-label="Move up">↑</button><button data-a="down" data-i="${i}" aria-label="Move down">↓</button><button data-a="rm" data-i="${i}">Remove</button>`
    : `<button data-a="play" data-i="${i}">Play now</button><button data-a="pn" data-i="${i}">Play next</button><button data-a="add" data-i="${i}">Queue</button>`;
  const extra = t.score ? `<small class="score">${t.score}% match. ${esc(t.transition)}: ${esc(t.reason)}</small>` : "";
  return `<div class="row${c}"><img src="${esc(t.art)}" alt="" loading="lazy"><div class="m"><b>${esc(t.title)}</b><small>${esc(t.artist)} on Audius${t.genre ? ", " + esc(t.genre) : ""}</small>${extra}</div>
  ${acts}<button data-a="fav" data-i="${i}" aria-label="Favourite">${isFav ? "★" : "☆"}</button></div>`;
}
const listFor = () => S.view === "favs" ? S.favs : S.view === "history" ? S.hist : S.results;
function render() {
  const t = cur();
  $("#title").textContent = t ? t.title : "Nothing playing"; $("#artist").textContent = t ? t.artist : "Search or start AI Radio";
  $("#art").src = t?.art || ""; $("#pp").textContent = audio.paused ? "▶" : "⏸";
  $("#shuf").classList.toggle("on", S.shuffle); $("#rep").classList.toggle("on", S.repeat);
  const L = listFor();
  $("#list").innerHTML = S.view === "diag" ? `<pre class="empty">${esc(JSON.stringify(S.diag || {}, null, 2))}</pre>` : L.length ? L.map((x, i) => row(x, "l", i)).join("") : `<div class="empty">${S.view === "favs" ? "Tap ☆ on a track to save it." : S.view === "history" ? "Songs you play show up here." : "Nothing here yet."}</div>`;
  $("#recs").innerHTML = S.recs.length ? S.recs.map((x, i) => row(x, "r", i)).join("") : `<div class="empty">Play a song to get three AI picks.</div>`;
  $("#queue").innerHTML = S.queue.length ? S.queue.map((x, i) => row(x, "q", i)).join("") : `<div class="empty">Queue is empty. Add songs with Queue.</div>`;
}

document.addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const i = +b.dataset.i, src = b.closest("#queue") ? S.queue : b.closest("#recs") ? S.recs : listFor(), t = src[i];
  ({ play: () => playNow(t), pn: () => addQueue(t, "next"), add: () => addQueue(t), rm: () => remove(i), up: () => move(i, -1), down: () => move(i, 1), fav: () => fav(t) })[b.dataset.a]?.();
});
document.querySelectorAll(".side button").forEach(b => b.onclick = () => load(b.dataset.view));
$("#sf").onsubmit = e => { e.preventDefault(); const q = $("#q").value.trim(); if (q.length >= 2) search(q); };
$("#pp").onclick = () => { if (!audio.src) return cur() ? playIndex(S.idx) : toast("Search for a song first."); audio.paused ? audio.play().catch(() => toast("Press play again.")) : audio.pause(); };
$("#next").onclick = next; $("#prev").onclick = prev; $("#radio").onclick = toggleRadio;
$("#shuf").onclick = () => { S.shuffle = !S.shuffle; render(); }; $("#rep").onclick = () => { S.repeat = !S.repeat; render(); };
$("#vol").oninput = e => audio.volume = e.target.value / 100; audio.volume = 0.8;
$("#seek").oninput = e => { if (audio.duration) audio.currentTime = audio.duration * e.target.value / 1000; };
audio.ontimeupdate = () => { if (audio.duration) $("#seek").value = audio.currentTime / audio.duration * 1000; $("#time").textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration); };
audio.onplay = audio.onpause = render; audio.onended = next;
audio.onerror = () => { if (audio.getAttribute("src")) { toast("Stream failed. Skipping."); setTimeout(next, 1200); } };
load("discover");
