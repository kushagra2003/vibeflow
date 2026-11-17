// VibeFlow DJ Console — hooks, fair hook rotation, transition memory, AI toggle and drag/drop queue.
const $ = s => document.querySelector(s);
const A = [$("#a1"), $("#a2")];
let ci = 0;
const audio = () => A[ci];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("vf_" + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vf_" + k, JSON.stringify(v)); } catch {} }
};
const defaults = {
  mixLength: 6, leadSubtract: 2, hookPlaySeconds: 24, noHookSeconds: 45, minTrackPlaySeconds: 40, noHookStartSeconds: 20, bpmTolerance: 8,
  displayUpdateDelay: 0, aiEnabled: true, autoHookDetection: true, profileHookDisplay: "manual", autoMode: "hook"
};
const settings = { ...defaults, ...store.get("settings", {}) };
settings.autoMode = settings.autoMode === "beginning" ? "beginning" : "hook";
settings.autoHookDetection = settings.autoHookDetection !== false;
settings.profileHookDisplay = settings.profileHookDisplay === "all" ? "all" : "manual";
const S = {
  queue: store.get("queue", []), idx: store.get("idx", -1),
  favs: store.get("favs", []), hist: store.get("hist", []),
  patterns: store.get("patterns", []), hookPlays: store.get("hookPlays", {}),
  trackPlays: store.get("trackPlays", {}), shuffle: false,
  repeat: false, autoMix: store.get("autoMix", false), currentCrossfadeSeconds: null, view: "discover", results: [], recs: [], busy: false,
  tok: 0, mixing: false, transitioning: false, activeHook: null, activeTrackStartedAt:null, autoTransitionPending:false,
  transitionTimer: null, env: {}, lib: [], dragIndex: null,
  seeking: false, seekResetMediaTime: null, seekResetDelay: 0, seekResumeAt: 0,
  activeNoHookDeadline: null, displayUpdateTimer: null,
  hookScans: store.get("hookScans", {}), autoHookInFlight: new Set(), autoHookStartedAt: {},
  aiHookTrackId: null, aiHookScanning: false, hookEditTarget: {}, bpmCache: store.get("bpmCache", {}), autoMixNextPromise: null, training:{active:false,pending:null,feedbackTimer:null,originalDetection:true,originalMode:"hook",originalAutoMix:false,busy:false}
};
const save = () => {
  for (const [k, v] of Object.entries({
    queue:S.queue, idx:S.idx, favs:S.favs, hist:S.hist,
    patterns:S.patterns, hookPlays:S.hookPlays, trackPlays:S.trackPlays, hookScans:S.hookScans, bpmCache:S.bpmCache
  })) store.set(k, v);
};
const saveSettings = () => store.set("settings", settings);
const automaticSwitchingEnabled = () => S.autoMix === true;
const toast = msg => {
  const el = $("#toast"); el.textContent = msg; el.style.display = "block";
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = "none", 3800);
};
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const displaySongTitle = value => { const full=String(value||"Untitled"); const short=full.length>15?full.slice(0,15)+"…":full; return short+" By Vibe Glow AI"; };
const fmt = n => Number.isFinite(+n) ? `${Math.floor(+n/60)}:${String(Math.floor(+n%60)).padStart(2,"0")}` : "0:00";
const fmtHook = n => `${fmt(n)}${Math.abs((+n)-Math.round(+n))>.01?".5":""}`;
const cur = () => S.queue[S.idx] || null;
const mixSec = () => Number.isFinite(Number(settings.mixLength)) ? Number(settings.mixLength) : 6;
const chooseCrossfadeSeconds = () => settings.mixLength === "random" ? [3,6,9][Math.floor(Math.random()*3)] : mixSec();
const vol = () => $("#vol").value / 100;
const hookKey = (track, hook) => `${track.id}::${hook.id || hook.t}`;
const toTrack = f => ({
  id:"my:"+f.file, title:f.title, artist:f.artist || "Unknown",
  provider:"mine", file:f.file, url:"songs/"+encodeURIComponent(f.file),
  art:f.art || "", genre:f.genre || "", hooks:Array.isArray(f.hooks)?f.hooks:[]
});
const getUrl = async t => t.provider === "mine"
  ? t.url
  : (await api("audius-stream?id="+encodeURIComponent(t.id))).url;

// ---------- Library discovery: scan GitHub folder, no songs.json ----------
async function initLib() {
  const local = store.get("lib", []);
  const endpoint = "https://api.github.com/repos/kushagra2003/vibeflow/contents/songs?ref=main";
  try {
    const r = await fetch(endpoint, {cache:"no-store"});
    if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
    const files = await r.json();
    if (!Array.isArray(files)) throw new Error("GitHub did not return a folder listing");
    const discovered = files.filter(f => f.type === "file" && /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name)).map(f => {
      const base = f.name.replace(/\.[^.]+$/, "");
      const p = base.split(" - ");
      return {
        file:f.name,
        artist:p.length > 1 ? p.shift().trim() : "Unknown",
        title:p.length ? p.join(" - ").trim() : base.replace(/[_-]+/g," ").trim(),
        hooks:[]
      };
    });
    // Pull the shared GitHub hook archive before reconciling this browser's local copy.
    let sharedHooks = {};
    try {
      const shared = await fetch("/api/hooks", {cache:"no-store"});
      if (shared.ok) {
        const payload = await shared.json();
        for (const item of (payload.songs || [])) if (item?.file) sharedHooks[item.file] = item.hooks || [];
        S.hookCloudReady = true;
        S.hookCloudConfigured = true;
      } else {
        const issue = await shared.json().catch(()=>({}));
        S.hookCloudReady = false;
        S.hookCloudConfigured = shared.status !== 503;
        console.warn("Shared hook archive unavailable:", issue.error || shared.status);
      }
    } catch (error) {
      S.hookCloudReady = false;
      S.hookCloudConfigured = false;
      console.warn("Shared hook archive unavailable; using this browser's backup.", error);
    }
    const localMap = new Map((Array.isArray(local)?local:[]).filter(x=>x?.file).map(x=>[x.file,x]));
    const archivedHooks = store.get("hookArchive", {});
    const merged = new Map();
    for (const song of discovered) {
      const old = localMap.get(song.file) || {};
      merged.set(song.file, {...song,...old,hooks:mergeHookLists(sharedHooks[song.file], old.hooks, archivedHooks[song.file], song.hooks)});
    }
    S.lib = [...merged.values()];
    $("#libraryStatus").textContent = S.hookCloudReady ? `${S.lib.length} songs · shared hooks loaded` : `${S.lib.length} songs discovered · local hook backup`;
    saveLib();
  } catch (e) {
    console.error("GitHub discovery:", e);
    S.lib = Array.isArray(local) ? local : [];
    S.hookCloudConfigured = false; S.hookCloudReady = false;
    $("#libraryStatus").textContent = "GitHub library unavailable";
    toast(`GitHub library error: ${e.message}`);
  }
  render();
}
let hookCloudTimer = null;
let hookCloudInFlight = false;
let hookCloudPending = false;
const hooksBackupPayload = () => ({app:"VIBE FLOW",version:1,updatedAt:new Date().toISOString(),
  songs:S.lib.filter(x=>x?.file).map(x=>({file:x.file,title:x.title,artist:x.artist,hooks:hooksOf(x)}))});
async function syncHooksToGitHub() {
  if (!S.hookCloudConfigured || !S.hookCloudReady) return;
  if (hookCloudInFlight) { hookCloudPending = true; return; }
  hookCloudInFlight = true;
  try {
    const response = await fetch("/api/hooks", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(hooksBackupPayload())});
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result.error || "GitHub hook backup failed ("+response.status+")");
    S.hookCloudReady = true;
    const status=$("#libraryStatus");
    if(status) status.textContent = S.lib.length+" songs · hooks backed up to GitHub";
  } catch(error) {
    console.error("GitHub hook backup:",error);
    S.hookCloudReady = false;
    toast("Hooks are saved in this browser, but GitHub backup failed. Export a backup or retry later.");
  } finally {
    hookCloudInFlight = false;
    if(hookCloudPending){hookCloudPending=false;syncHooksToGitHub();}
  }
}
const saveLib = () => {
  store.set("lib", S.lib);
  const archive = Object.fromEntries(S.lib.filter(x=>x?.file).map(x=>[x.file, hooksOf(x)]));
  store.set("hookArchive", archive);
  clearTimeout(hookCloudTimer);
  hookCloudTimer = setTimeout(syncHooksToGitHub, 900);
};
function mergeHookLists(...lists) {
  const merged=[];
  for(const list of lists) for(const h of Array.isArray(list)?list:[]) {
    const duplicate=merged.some(x=>String(x.id||"")===String(h.id||"") ||
      (Math.abs(Number(x.t)-Number(h.t))<0.35 && String(x.lyric||"").trim().toLowerCase()===String(h.lyric||"").trim().toLowerCase()));
    if(!duplicate) merged.push({...h});
  }
  return merged.sort((a,b)=>Number(a.t)-Number(b.t));
}
function exportHooksBackup() {
  const payload={app:"VIBE FLOW",version:1,exportedAt:new Date().toISOString(),
    songs:S.lib.filter(x=>x?.file).map(x=>({file:x.file,title:x.title,artist:x.artist,hooks:hooksOf(x)}))};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url; link.download="vibeflow-hooks-backup-"+new Date().toISOString().slice(0,10)+".json";
  link.click(); URL.revokeObjectURL(url);
  toast("Hook backup exported. Keep this JSON file somewhere safe.");
}
async function importHooksBackup(file) {
  if(!file) return;
  try {
    const payload=JSON.parse(await file.text());
    if(!Array.isArray(payload.songs)) throw new Error("This is not a VIBE FLOW hooks backup.");
    let restored=0;
    for(const saved of payload.songs) {
      const entry=S.lib.find(x=>x.file===saved.file);
      if(!entry) continue;
      const before=hooksOf(entry).length;
      entry.hooks=mergeHookLists(entry.hooks,saved.hooks);
      restored+=Math.max(0,entry.hooks.length-before);
    }
    saveLib(); render();
    toast("Backup merged safely: "+restored+" hook(s) restored. Existing hooks were not replaced.");
  } catch(error) { toast(error.message||"Could not import this hook backup."); }
}
const getLibTrack = id => S.lib.find(f => "my:"+f.file === id);
const hooksOf = t => Array.isArray(t?.hooks) ? t.hooks : [];

// ---------- Manual punch library ----------
// Punches are independent of hooks: each is a manually selected time range.
function punchesFor(track) { return Array.isArray(track?.punches) ? track.punches : []; }
function syncPunches(trackId, punches) {
  const entry=getLibTrack(trackId); if(entry) entry.punches=punches;
  for(const list of [S.queue,S.results,S.recs,S.favs,S.hist]) for(const t of list) if(t?.id===trackId)t.punches=punches;
}
function savePunchStart() {
  const t=cur(), entry=t&&getLibTrack(t.id);
  if(!entry) return toast("Punches can currently be saved for songs in My music.");
  S.punchDraft={trackId:t.id,trackTitle:t.title,trackArtist:t.artist,start:Number(audio().currentTime.toFixed(2)),end:null};
  $("#punchStartTime").textContent=fmt(S.punchDraft.start)+" · "+t.title;
  $("#punchName").dataset.draftTrackId=t.id;
  toast("Punch IN saved for "+t.title+". Name it, then mark punch OUT.");
}
function savePunchEnd() {
  const draft=S.punchDraft;
  if(!draft) return toast("Mark punch IN first.");
  if(cur()?.id!==draft.trackId) return toast("Return to "+draft.trackTitle+" to mark punch OUT. Your punch draft is still saved.");
  const end=Number(audio().currentTime.toFixed(2));
  if(end-draft.start<2) return toast("A punch must be at least 2 seconds long.");
  draft.end=end;
  $("#punchStartTime").textContent=fmt(draft.start)+" → "+fmt(end);
  $("#savePunch").disabled=false;
  toast("Punch OUT marked. Add a name and click Save punch.");
}
function savePunch() {
  const draft=S.punchDraft;
  if(!draft || !Number.isFinite(draft.end)) return toast("Mark punch IN and OUT first.");
  const entry=getLibTrack(draft.trackId);
  if(!entry) return toast("The source song is no longer in My music.");
  const name=$("#punchName").value.trim();
  if(!name) return toast("Give this punch a name before saving.");
  const punch={id:crypto.randomUUID?.()||String(Date.now()),name,start:draft.start,end:draft.end,triggerHookId:"",createdAt:Date.now()};
  entry.punches=[...punchesFor(entry),punch]; syncPunches(draft.trackId,entry.punches);
  saveLib();save();S.punchDraft=null;$("#punchName").value="";$("#punchName").dataset.draftTrackId="";
  $("#punchStartTime").textContent="Not set";$("#savePunch").disabled=true;
  renderPunchDeck();toast("Punch saved: "+name+" · "+fmt(punch.start)+"–"+fmt(punch.end));
}
function allPunches() {
  return S.lib.flatMap(entry=>punchesFor(entry).map(p=>({...p,trackId:"my:"+entry.file,title:entry.title,artist:entry.artist,hooks:hooksOf(entry)})));
}
function renderPunchDeck() {
  const root=$("#homePunches"); if(!root)return;
  const pins=store.get("pinnedPunches",[]);
  const selected=pins.map(id=>allPunches().find(p=>p.id===id)).filter(Boolean).slice(0,4);
  root.innerHTML='<div class="punch-deck-head"><div><span class="eyebrow">YOUR QUICK CUES</span><b>Saved punches</b></div><button type="button" id="managePunches">Manage</button></div>'+
    (selected.length?'<div class="punch-deck-grid">'+selected.map(p=>'<div class="punch-card"><b>'+esc(p.title)+'</b><div class="punch-card-actions"><button type="button" data-punch-preview="'+esc(p.id)+'">Preview</button><button type="button" data-punch-queue="'+esc(p.id)+'">Play next</button><button type="button" data-punch-unpin="'+esc(p.id)+'">Remove from deck</button></div></div>').join(''):'<div class="empty-state">Add punches to your deck from Punch settings.</div>')+'</div>';
  $("#managePunches").onclick=openPunchManager;
  root.querySelectorAll("[data-punch-preview]").forEach(b=>b.onclick=()=>previewPunch(b.dataset.punchPreview));
  root.querySelectorAll("[data-punch-queue]").forEach(b=>b.onclick=()=>queuePunch(b.dataset.punchQueue));
  root.querySelectorAll("[data-punch-hook]").forEach(sel=>sel.onchange=()=>{const p=allPunches().find(x=>x.id===sel.dataset.punchHook);const entry=p&&getLibTrack(p.trackId);if(!entry)return;const cue=punchesFor(entry).find(x=>x.id===p.id);if(cue){cue.triggerHookId=sel.value;saveLib();syncPunches(p.trackId,punchesFor(entry));toast("Punch destination hook saved.");}});
  root.querySelectorAll("[data-punch-unpin]").forEach(b=>b.onclick=()=>{store.set("pinnedPunches",store.get("pinnedPunches",[]).filter(id=>id!==b.dataset.punchUnpin));renderPunchDeck();});
}
function openPunchManager() {
  const punches=allPunches(), pins=store.get("pinnedPunches",[]);
  const root=$("#modalRoot");
  root.innerHTML='<div class="modal-backdrop" data-punch-dismiss="1"><div class="modal-card" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">MANUAL DJ CUES</div><h2>Punch library</h2><p class="modal-sub">Pin up to four punches to your home screen.</p></div><button class="modal-close" data-punch-dismiss="1">×</button></div><div class="punch-manager-list">'+(punches.length?punches.map(p=>'<div class="punch-manager-row"><b>'+esc(p.title)+'</b><span>'+esc(p.name)+'</span><button type="button" data-punch-preview="'+esc(p.id)+'">Preview</button><button type="button" data-punch-queue="'+esc(p.id)+'">Play next</button><button type="button" data-pin-punch="'+esc(p.id)+'" '+(!pins.includes(p.id)&&pins.length>=4?'disabled':'')+'>'+(pins.includes(p.id)?'Remove from deck':'Add to deck')+'</button></div>').join(''):'<div class="empty-state">No punches saved yet. Play a song and mark a start and end.</div>')+'</div><div class="punch-manager-foot"><button type="button" data-punch-dismiss="1">Done</button></div></div></div>';
  root.querySelectorAll("[data-punch-dismiss]").forEach(b=>b.onclick=e=>{if(e.target===b||!b.classList.contains("modal-backdrop"))root.innerHTML="";});
  root.querySelectorAll("[data-pin-punch]").forEach(b=>b.onclick=()=>{let ids=store.get("pinnedPunches",[]);ids=ids.includes(b.dataset.pinPunch)?ids.filter(id=>id!==b.dataset.pinPunch):[...ids,b.dataset.pinPunch].slice(0,4);store.set("pinnedPunches",ids);openPunchManager();renderPunchDeck();});
  
  root.querySelectorAll("[data-punch-preview]").forEach(b=>b.onclick=()=>previewPunch(b.dataset.punchPreview));
  root.querySelectorAll("[data-punch-queue]").forEach(b=>b.onclick=()=>queuePunch(b.dataset.punchQueue));
}
async function previewPunch(id) {
  const p=allPunches().find(x=>x.id===id); if(!p)return;
  if(!cur()||audio().paused)return toast("Start a song first to preview a punch over it.");
  if(p.trackId===cur().id)return toast("Choose a punch from a different song.");
  const musicDeck=audio(), deck=A[1-ci], token=(S.punchPreviewToken||0)+1;
  S.punchPreviewToken=token;
  const masterVolume=vol();
  const clearPunch=restore=>{
    clearTimeout(S.punchPreviewTimer);clearTimeout(S.punchHardStopTimer);
    for(const d of A){clearInterval(d._punchFade);d._punchFade=null;}
    deck.pause();deck.currentTime=Number(p.end)||deck.currentTime;deck.removeAttribute("src");deck.load();
    if(restore){musicDeck.volume=masterVolume;if(S.punchDuckDeck===musicDeck)S.punchDuckDeck=null;}
  };
  try {
    clearTimeout(S.punchPreviewTimer);clearTimeout(S.punchHardStopTimer);
    for(const d of A){clearInterval(d._punchFade);d._punchFade=null;}
    if(S.punchDuckDeck)S.punchDuckDeck.volume=masterVolume;
    musicDeck.volume=masterVolume;S.punchDuckDeck=musicDeck;
    deck.pause();deck.src=await getUrl(toTrack(getLibTrack(p.trackId)));
    await waitMetadata(deck);
    if(token!==S.punchPreviewToken)return;
    const length=Math.max(.1,Number(p.end)-Number(p.start));
    const rampMs=Math.max(100,Math.min(1500,length*200));
    deck.currentTime=Number(p.start);deck.volume=0;await deck.play();
    const fade=(target,from,to,duration,done)=>{
      clearInterval(target._punchFade);const started=performance.now();
      target._punchFade=setInterval(()=>{
        const progress=Math.min(1,(performance.now()-started)/duration),e=progress*progress*(3-2*progress);
        target.volume=from+(to-from)*e;
        if(progress>=1){clearInterval(target._punchFade);target._punchFade=null;if(done)done();}
      },20);
    };
    fade(deck,0,masterVolume,rampMs);fade(musicDeck,masterVolume,masterVolume*.65,rampMs);
    S.punchPreviewTimer=setTimeout(()=>{
      if(token!==S.punchPreviewToken)return;
      fade(deck,deck.volume,0,rampMs,()=>{deck.pause();deck.removeAttribute("src");deck.load();});
      fade(musicDeck,musicDeck.volume,masterVolume,rampMs,()=>{if(S.punchDuckDeck===musicDeck)S.punchDuckDeck=null;});
    },Math.max(0,length*1000-rampMs));
    // Independent hard stop: the preview deck can never run past the saved punch OUT.
    S.punchHardStopTimer=setTimeout(()=>{
      if(token!==S.punchPreviewToken)return;
      clearInterval(deck._punchFade);deck._punchFade=null;deck.pause();deck.removeAttribute("src");deck.load();
      clearInterval(musicDeck._punchFade);musicDeck._punchFade=null;musicDeck.volume=masterVolume;
      if(S.punchDuckDeck===musicDeck)S.punchDuckDeck=null;
    },length*1000+80);
    toast("Punch preview started. It will stop at "+fmt(p.end)+".");
  } catch(e){
    clearTimeout(S.punchPreviewTimer);clearTimeout(S.punchHardStopTimer);
    for(const d of A){clearInterval(d._punchFade);d._punchFade=null;}
    deck.pause();musicDeck.volume=masterVolume;if(S.punchDuckDeck===musicDeck)S.punchDuckDeck=null;
    toast("Could not preview this punch: "+e.message);
  }
}
function queuePunch(id) {
  const p=allPunches().find(x=>x.id===id);if(!p)return;
  if(p.trackId===cur()?.id)return toast("Choose a punch from a different song.");
  const entry=getLibTrack(p.trackId),track=toTrack(entry);
  addQueue(track,"next");
  const queued=S.queue.find(x=>x.id===track.id);
  if(queued){queued._chosenPunch={id:p.id,start:p.start,end:p.end};const destination=(p.hooks||[]).find(h=>String(h.id)===String(p.triggerHookId||""));if(destination)queued._chosenHook={id:destination.id};}
  save();render();toast("Punch queued. It will take over at the current song's next hook transition.");
}
async function maybeSurprisePunch() {
  if(!S.autoMix||S.transitioning||S.punchSurpriseBusy)return;
  const count=allPunches().filter(p=>p.trackId!==cur()?.id);
  if(!count.length)return;
  S.punchSurpriseBusy=true;
  const p=count[Math.floor(Math.random()*count.length)];
  const entry=getLibTrack(p.trackId),track=entry&&toTrack(entry);
  if(!track){S.punchSurpriseBusy=false;return;}
  const hook=preferredHooks(track).find(h=>Number(h.t)>=p.start&&Number(h.t)<p.end)||{id:p.id,t:p.start,end:p.end,lyric:p.name,source:"manual"};
  await transitionTo(track,hook,{manual:true,mode:"hook"});
  S.punchSurpriseBusy=false;
}

// ---------- Settings ----------
function openSettings() {
  const root = $("#modalRoot");
  root.innerHTML = `
  <div class="modal-backdrop" data-close="1"><div class="modal-card" role="dialog" aria-modal="true">
    <div class="modal-head"><div><div class="eyebrow">PERSONALISE YOUR DJ</div><h2>VibeFlow settings</h2><p class="modal-sub">Control how tracks are selected, mixed and repeated.</p></div><button class="modal-close" data-close="1">×</button></div>
    <div class="toggle-row"><div><b>AI recommendations</b><small>Control personalised track suggestions.</small></div><input class="switch" id="setAI" type="checkbox" ${settings.aiEnabled?"checked":""}></div>
    <div class="toggle-row"><div><b>Automatic hook detection</b><small>When off, generated hooks are hidden and only manually saved hooks are used.</small></div><input class="switch" id="setAutoHookDetection" type="checkbox" ${settings.autoHookDetection?"checked":""}></div>
    <div class="setting-field" style="margin-top:14px"><label for="setProfileHookDisplay">Profile hook counts</label><select id="setProfileHookDisplay"><option value="manual">Only manually saved / approved hooks</option><option value="all">All hooks (manual + generated)</option></select><small>Controls the hook counts and hook picker shown beside songs in your profile and lists. It does not delete hooks or change DJ selection.</small></div>
    <div class="settings-grid" style="margin-top:14px">
      <div class="setting-field"><label for="setMix">Crossfade length</label><select id="setMix"><option value="0">Off (no crossfade)</option><option value="3">3 seconds</option><option value="6">6 seconds</option><option value="9">9 seconds</option><option value="random">Random (3 / 6 / 9 seconds)</option></select><small>Random chooses a fresh 3, 6 or 9 second crossfade for each transition.</small></div>
      <div class="setting-field"><label for="setLead">Seconds to subtract from mix length</label><input id="setLead" type="number" min="0" max="8" step="1" value="${settings.leadSubtract}"><small>Default 2. Hook starts at hook time − (mix length − this value).</small></div>
      <div class="setting-field"><label for="setHookDuration">Play time after hook start</label><input id="setHookDuration" type="number" min="5" max="300" step="1" value="${settings.hookPlaySeconds}"><div class="seconds-stepper" aria-label="Adjust hook seconds"><button type="button" id="hookSecondsDown" title="Decrease by 1 second" aria-label="Decrease hook seconds">▼</button><span>−1 sec</span><button type="button" id="hookSecondsUp" title="Increase by 1 second" aria-label="Increase hook seconds">▲</button></div><small>Play the selected hook for this many seconds from its start, even if an end point is marked. Use the arrows to adjust by exactly 1 second.</small></div>
      <div class="setting-field"><label for="setNoHook">Fallback time without a hook end</label><input id="setNoHook" type="number" min="5" max="600" step="5" value="${settings.noHookSeconds}"><small>Switch after this many seconds if no hook end is available.</small></div>
      <div class="setting-field"><label for="setMinTrackPlay">Minimum track playtime</label><input id="setMinTrackPlay" type="number" min="5" max="600" step="5" value="${settings.minTrackPlaySeconds??40}"><small>Minimum actual playback before Auto Mix switches. A manually saved hook end may trigger earlier.</small></div>
      <div class="setting-field"><label for="setNoHookStart">Start position when no hook is saved</label><input id="setNoHookStart" type="number" min="0" max="300" step="1" value="${settings.noHookStartSeconds}"><small>Start unmarked songs at this position. Default: 20 seconds.</small></div>
      <div class="setting-field"><label for="setDisplayDelay">Update current / next song details</label><select id="setDisplayDelay"><option value="0">Immediately (0 seconds)</option><option value="1">After 1 second</option><option value="2">After 2 seconds</option><option value="3">After 3 seconds</option><option value="4">After 4 seconds</option><option value="5">After 5 seconds</option></select><small>Wait this long after the new track starts before refreshing the Now Playing and Coming Up Next details.</small></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button data-close="1">Cancel</button><button id="saveSettings" class="primary-btn">Save settings</button></div>
  </div></div>`;
  $("#setMix").value = String(settings.mixLength);
  $("#setProfileHookDisplay").value = settings.profileHookDisplay;
  $("#setDisplayDelay").value = String([0,1,2,3,4,5].includes(+settings.displayUpdateDelay)?settings.displayUpdateDelay:0);
  const hookSecondsInput=$("#setHookDuration");
  $("#hookSecondsDown").onclick=()=>{hookSecondsInput.value=String(Math.max(5,(+hookSecondsInput.value||settings.hookPlaySeconds)-1));};
  $("#hookSecondsUp").onclick=()=>{hookSecondsInput.value=String(Math.min(300,(+hookSecondsInput.value||settings.hookPlaySeconds)+1));};
  root.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",e=>{
    if (x.classList.contains("modal-backdrop") ? e.target === x : true) root.innerHTML="";
  }));
  $("#saveSettings").onclick = () => {
    settings.aiEnabled = $("#setAI").checked;
    settings.autoHookDetection = $("#setAutoHookDetection").checked;
    settings.profileHookDisplay = $("#setProfileHookDisplay").value === "all" ? "all" : "manual";
    settings.mixLength = $("#setMix").value==="random" ? "random" : ([0,3,6,9].includes(+$("#setMix").value) ? +$("#setMix").value : 6);
    settings.leadSubtract = Math.max(0,Math.min(8,+$("#setLead").value || 0));
    settings.hookPlaySeconds = Math.max(5,Math.min(300,+$("#setHookDuration").value || 24));
    settings.noHookSeconds = Math.max(5,Math.min(600,+$("#setNoHook").value || 45));
    settings.minTrackPlaySeconds = Math.max(5,Math.min(600,+$("#setMinTrackPlay").value || 40));
    settings.noHookStartSeconds = Math.max(0,Math.min(300,+$("#setNoHookStart").value || 0));
    settings.displayUpdateDelay = [0,1,2,3,4,5].includes(+$("#setDisplayDelay").value)?+$("#setDisplayDelay").value:0;
    saveSettings(); root.innerHTML=""; syncControls(); render();
    toast("DJ settings saved.");
  };
}
function updateCrossfadeIndicator() {
  const el=$("#crossfadeStatus");
  if(!el) return;
  const active=S.currentCrossfadeSeconds;
  if(S.mixing && active!=null && active>0) {
    el.textContent="CROSSFADE · "+active+"s";
    el.classList.add("crossfade-active");
  } else {
    el.textContent=settings.mixLength==="random"?"CROSSFADE · RANDOM (3 / 6 / 9s)":"CROSSFADE · "+(mixSec()===0?"OFF":mixSec()+"s");
    el.classList.remove("crossfade-active");
  }
}
function syncControls() {
  $("#mixsec").value = String(settings.mixLength);
  updateCrossfadeIndicator();
  $("#autoMode").value = settings.autoMode;
  const toggle=$("#autoMixToggle");
  if(toggle) {
    toggle.classList.toggle("enabled",S.autoMix);
    toggle.setAttribute("aria-pressed",String(S.autoMix));
    toggle.querySelector(".auto-mix-switch-state").textContent=S.autoMix?"AUTO MIX ON":"NO AUTO MIX";
    toggle.querySelector(".auto-mix-switch-thumb").textContent=S.autoMix?"ON":"OFF";
  }
}

// ---------- API ----------
async function api(fn, opts) {
  const r = await fetch("/api/"+fn,opts);
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

// ---------- Hooks: mark start and end ----------
function addHook() {
  const t=cur(); if(!t || t.provider!=="mine") return toast("Select a song from My music to save hooks.");
  const label=$("#hookLabel").value.trim() || `Hook ${hooksOf(t).length+1}`;
  const entry=getLibTrack(t.id); if(!entry) return;
  const h={id:crypto.randomUUID?.() || String(Date.now()),t:Math.round(audio().currentTime*2)/2,end:null,lyric:label,endLyric:"",source:"manual"};
  entry.hooks=[...hooksOf(entry),h].sort((a,b)=>a.t-b.t);
  t.hooks=entry.hooks; S.activeNoHookDeadline=null; S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:null};
  $("#hookLabel").value=""; saveLib(); save(); renderHooks(); render();
  toast(`Hook marked at ${fmt(h.t)}. Mark its end when the hook finishes.`);
}
function renameHook(id) {
  const t=cur(),entry=t&&getLibTrack(t.id);if(!entry)return;
  const hook=hooksOf(entry).find(h=>String(h.id)===String(id));if(!hook)return;
  const next=prompt("Name this hook (use the lyric or chorus line):",hook.name||hook.lyric||"");
  if(next===null)return;
  const name=next.trim();if(!name)return toast("Hook name cannot be empty.");
  hook.name=name;hook.lyric=name;
  syncTrackHooks(t.id,entry.hooks);saveLib();save();renderHooks();render();
  toast("Hook renamed to "+name+".");
}
function adjustHookTime(id,delta,target="start") {
  const t=cur(), entry=t && getLibTrack(t.id);
  if(!entry) return;
  const h=hooksOf(entry).find(x=>String(x.id)===String(id));
  if(!h) return;
  if(target==="end") {
    if(h.end==null) return toast("Mark an ending first, then adjust it by half a second.");
    const minEnd=Number(h.t||0)+0.5;
    h.end=Math.max(minEnd,Math.round((Number(h.end)+delta)*2)/2);
    h.endSource="manual"; h.endApproved=true;
  } else {
    const maxStart=h.end!=null ? Math.max(0,Number(h.end)-0.5) : Infinity;
    h.t=Math.max(0,Math.min(maxStart,Math.round((Number(h.t||0)+delta)*2)/2));
  }
  t.hooks=entry.hooks;
  if(S.activeHook?.trackId===t.id && String(S.activeHook.hookId)===String(id)) {
    S.activeHook.t=h.t; S.activeHook.end=h.end ?? null; S.activeHook.endSource=h.endSource ?? null; S.activeHook.endApproved=h.endApproved===true;
  }
  syncTrackHooks(t.id,entry.hooks);
  saveLib(); save();
  renderHooks();
}
function markHookEnd(id) {
  const t=cur(), entry=t && getLibTrack(t.id);
  if(!entry) return;
  const h=hooksOf(entry).find(x=>String(x.id)===String(id));
  if(!h) return;
  const end=+audio().currentTime.toFixed(2);
  if(end<=h.t) return toast("Hook end must be after its start.");
  h.end=end;
  h.endSource="manual"; h.endApproved=true;
  h.endLyric=$("#endLine-"+CSS.escape(String(id)))?.value?.trim() || h.endLyric || "";
  t.hooks=entry.hooks;
  if(S.activeHook?.trackId===t.id && String(S.activeHook.hookId)===String(id)) { S.activeHook.end=end; S.activeHook.endSource="manual"; S.activeHook.endApproved=true; }
  syncTrackHooks(t.id,entry.hooks);
  saveLib(); save(); renderHooks(); render();
  toast(`Hook end saved at ${fmt(end)}. Auto mix will switch at this point.`);
}
function verifyAutoHook(id) {
  const t=cur(), entry=t && getLibTrack(t.id);
  if(!entry) return;
  const hook=hooksOf(entry).find(x=>String(x.id)===String(id));
  if(!hook || hook.source!=="auto") return;
  hook.source="manual"; hook.verifiedAt=Date.now();
  t.hooks=entry.hooks; syncTrackHooks(t.id,entry.hooks);
  saveLib(); save(); renderHooks(); render();
  toast("Hook saved and verified. It is now marked as a manual cue.");
}
function deleteHook(id) {
  const t=cur(), entry=t && getLibTrack(t.id); if(!entry) return;
  entry.hooks=hooksOf(entry).filter(h=>String(h.id)!==String(id));
  t.hooks=entry.hooks;
  if(S.activeHook?.hookId===id) S.activeHook=null;
  saveLib(); renderHooks(); render();
}
function playHookDirect(h) {
  const t=cur(); if(!t || !audio().src) return;
  audio().currentTime=h.t;
  S.activeNoHookDeadline=null;
  S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:h.end ?? null,source:h.source??"manual",endSource:h.endSource ?? null,endApproved:h.endApproved===true || h.endSource==="manual",lyric:h.lyric||"Hook"};
  markHookPlayed(t,h);
  renderHooks();
  $("#hookStatus").textContent=`${h.lyric || "Hook"} · ${fmt(h.t)}`;
  toast(`Jumped directly to ${fmt(h.t)}.`);
}
function syncTrackHooks(trackId, hooks) {
  for (const list of [S.queue, S.results, S.recs, S.favs, S.hist]) {
    for (const track of list) if (track?.id === trackId) track.hooks = hooks;
  }
}
async function scanCurrentSongHooks({automatic=false,trackOverride=null}={}) {
  if(!settings.autoHookDetection) { if(!automatic) toast("Automatic hook detection is turned off in Settings."); return; }
  const track=trackOverride||cur();
  if(!track || track.provider!=="mine") {
    if(!automatic) toast("Local hook analysis currently scans songs in My music.");
    return;
  }
  const entry=getLibTrack(track.id);
  if(!entry?.file) {
    if(!automatic) toast("Could not locate this song in your GitHub music folder.");
    return;
  }
  if(S.aiHookScanning || (automatic && (S.autoHookInFlight.has(track.id)||(S.hookScans[track.id]?.version||0)>=2))) return;
  const button=$("#scanHooks");
  if(automatic) {
    S.autoHookInFlight.add(track.id);
    S.autoHookStartedAt[track.id]=Date.now();
    setDJActivity("AUTO SCAN · NEXT TRACK","No saved hooks on "+track.title+" · analysing musical patterns locally","SCAN","sync");
  } else {
    S.aiHookScanning=true;
    S.aiHookTrackId=track.id;
    if(button){button.disabled=true;button.textContent="◌ Analysing audio…";}
    renderAIHookSuggestions();
  }
  try {
    const candidates=await window.VibeHookScanner.analyse("songs/"+encodeURIComponent(entry.file));
    const existing=hooksOf(entry);
    let upgradedEnds=0;
    for(const candidate of candidates) {
      const match=existing.find(h=>h.source==="auto" && (
        Math.abs(Number(h.t)-candidate.t)<30 ||
        String(h.lyric||"").trim().toLowerCase()===candidate.label.toLowerCase()
      ));
      if(match && match.end==null && candidate.end!=null && Number(candidate.end)>Number(match.t)) {
        match.end=Math.max(Number(match.t)+0.5,Math.round(Number(candidate.end)*2)/2);
        match.endSource="auto";
        upgradedEnds++;
      }
    }
    const accepted=candidates.filter(candidate=>!existing.some(h=>
      Math.abs(Number(h.t)-candidate.t)<30 ||
      (String(h.lyric||"").trim().toLowerCase()===candidate.label.toLowerCase())
    )).slice(0,3);
    const generated=accepted.map(candidate=>({
      id:"auto-"+(crypto.randomUUID?.()||String(Date.now()+Math.random())),
      t:Math.round(candidate.t*2)/2,
      end:candidate.end!=null && Number(candidate.end)>Number(candidate.t)
        ? Math.max(Math.round(candidate.t*2)/2+0.5,Math.round(Number(candidate.end)*2)/2)
        : null,
      endSource:candidate.end!=null && Number(candidate.end)>Number(candidate.t)?"auto":null,
      lyric:candidate.label,
      endLyric:"",
      source:"auto",
      detector:candidate.type,
      confidence:candidate.confidence,
      generatedAt:Date.now()
    }));
    if(generated.length || upgradedEnds) {
      entry.hooks=[...existing,...generated].sort((a,b)=>a.t-b.t);
      syncTrackHooks(track.id,entry.hooks);
      saveLib();
    }
    S.hookScans[track.id]={at:Date.now(),generated:generated.length,upgradedEnds,version:2};
    save();
    if(automatic) {
      setDJActivity(generated.length?"HOOKS AUTO-DETECTED":"SCAN COMPLETE · NO STRONG MATCH",
        (generated.length||upgradedEnds)?generated.length+" new cue(s), "+upgradedEnds+" existing ending(s) updated on "+track.title:"No strong repeated section found on "+track.title,
        "READY","ready");
    } else if(generated.length) {
      toast("Found "+generated.length+" new hook(s); updated "+upgradedEnds+" existing hook ending(s). AUTO cues are saved and ready to mix.");
    } else {
      toast("Analysis complete. No strong hook patterns found; your existing hooks were left untouched.");
    }
  } catch(error) {
    if(automatic) {
      S.hookScans[track.id]={at:Date.now(),generated:0,version:1,error:String(error.message||error).slice(0,180)};
      save();
      setDJActivity("AUTO SCAN UNAVAILABLE",String(error.message||error).slice(0,130),"READY","ready");
    } else {
      toast(error.message||"Local hook analysis could not scan this song.");
    }
  } finally {
    if(automatic) {
      S.autoHookInFlight.delete(track.id);
      delete S.autoHookStartedAt[track.id];
      const upcoming=S.queue[S.idx+1];
      if(S.autoMix && upcoming?.id===track.id && !audio().paused && !S.transitioning) {
        const active=S.activeHook?.trackId===cur()?.id?S.activeHook:null;
        const deadline=active?(active.t+settings.hookPlaySeconds):(S.activeNoHookDeadline?.at??settings.noHookSeconds);
        if(audio().currentTime>=deadline-2) setTimeout(()=>nextAutomatic(),0);
      }
    } else {
      S.aiHookScanning=false;
      if(button){button.disabled=false;button.textContent="⌕ Analyse for hooks";}
    }
    renderAIHookSuggestions();
    renderHooks();
    render();
  }
}
function maybeAutoScanUpcoming(track) {
  if(!settings.autoHookDetection || !S.autoMix || settings.autoMode!=="hook" || !track || track.provider!=="mine") return;
  const needsEndUpgrade=hooksOf(track).some(h=>h.source==="auto" && h.end==null);
  if(hooksOf(track).length && !needsEndUpgrade) return;
  if((S.hookScans[track.id]?.version||0)>=2 || S.autoHookInFlight.has(track.id) || S.aiHookScanning) return;
  scanCurrentSongHooks({automatic:true,trackOverride:track});
}
function renderAIHookSuggestions() {
  const root=$("#aiHookResults"); if(!root) return;
  if(S.aiHookScanning) {
    root.innerHTML='<div class="ai-hook-status">◌ Analysing repeated musical patterns and energy peaks in your browser…</div>';
    return;
  }
  const active=[...S.autoHookInFlight][0];
  if(active) {
    const song=getLibTrack(active);
    root.innerHTML='<div class="ai-hook-status">◌ Auto mix is scanning the upcoming track: '+esc(song?.title||"next song")+'. Generated cues will be saved automatically.</div>';
    return;
  }
  const track=cur(), scan=track&&S.hookScans[track.id];
  if(scan) {
    root.innerHTML='<div class="ai-hook-status">'+(scan.generated
      ? scan.generated+" AUTO hook(s) detected in the last local scan. They are ready for mixing and can be deleted individually."
      : "Last local scan found no strong repeated or high-energy sections. Your manually saved hooks remain unchanged.")+'</div>';
    return;
  }
  root.innerHTML='<div class="ai-hook-status">Click Analyse for hooks to scan this song locally. Auto mix can also scan an unmarked upcoming song in From hook mode. No API key or audio upload required.</div>';
}
function renderHooks() {
  const t=cur(), allHooks=hooksOf(t);
  const hooks=settings.autoHookDetection ? allHooks : allHooks.filter(h=>h.source!=="auto");
  const punchHookSelect=$("#punchTriggerHook");
  if(punchHookSelect){
    const selected=punchHookSelect.value;
    punchHookSelect.innerHTML='<option value="">Use punch start when queued</option>'+hooks.map(h=>'<option value="'+esc(h.id)+'">'+esc(h.name||h.lyric||"Hook")+' · '+fmt(h.t)+'</option>').join("");
    if(allHooks.some(h=>String(h.id)===String(selected)))punchHookSelect.value=selected;
  }
  $("#hookCount").textContent=`${hooks.length} saved · ${hooks.filter(h=>h.source==='auto').length} auto`;
  if(!t || t.provider!=="mine") {
    $("#hooksList").innerHTML='<div class="empty-state">Hooks can be marked on songs in My music.</div>';
    return;
  }
  if(!hooks.length) {
    $("#hooksList").innerHTML='<div class="empty-state">No hooks yet. Play the song and press “Mark hook here”.</div>';
    return;
  }
  $("#hooksList").innerHTML=hooks.map((h,i)=>{
    const isActive=S.activeHook?.trackId===t.id && String(S.activeHook.hookId)===String(h.id);
    const isManual=h.source!=="auto";
    const target=S.hookEditTarget[h.id]==="end"?"end":"start";
    const editingEnd=target==="end";
    const shown=editingEnd?h.end:h.t;
    return `
    <div class="hook-item ${h.source==="auto"?"auto-hook-item":"manual-hook-item"} ${isManual?"saved-manual-hook":""} ${isActive?"active-hook-item":""}">
      <div class="hook-main">
        <div class="hook-time-editor">
          <div class="hook-edit-toggle" role="group" aria-label="Choose hook time to adjust">
            <button type="button" data-hook-target="${esc(h.id)}" data-target="start" class="${!editingEnd?"selected":""}">START</button>
            <button type="button" data-hook-target="${esc(h.id)}" data-target="end" class="${editingEnd?"selected":""}">END</button>
          </div>
          <div class="hook-time-control" aria-label="Adjust hook ${target} time">
            <button type="button" data-hook-adjust="${esc(h.id)}" data-target="${target}" data-delta="-0.5" aria-label="Move hook ${target} back half a second" title="−0.5 seconds">−</button>
            <span class="hook-time">${shown==null?"Not set":fmtHook(shown)}</span>
            <button type="button" data-hook-adjust="${esc(h.id)}" data-target="${target}" data-delta="0.5" aria-label="Move hook ${target} forward half a second" title="+0.5 seconds">+</button>
          </div>
          ${editingEnd&&h.end==null?'<small class="hook-end-help">Mark an end while the song plays to enable adjustment</small>':""}
        </div>
        <div class="hook-detail">
          <b title="${esc(h.lyric || "Hook "+(i+1))}">${esc(h.lyric || "Hook "+(i+1))}${isActive?'<span class="active-hook-badge">CURRENT HOOK</span>':""}</b>
          <small><span class="hook-origin ${h.source==="auto"?"auto":"manual"}">${h.source==="auto"?"AUTO":"MANUAL"}</span> · ${h.source==="auto"?(h.detector==="repeated-section"?"Pattern match":"Energy peak"):"User cue"} · ${h.end!=null?`Ends ${fmt(h.end)}${h.endSource==="manual"?" · approved": " · detected, not used until approved"}${h.endLyric?" · "+esc(h.endLyric):""}`:"End not marked"}</small>
        </div>
      </div>
      <div class="hook-controls">
        <button data-hook-go="${esc(h.id)}" title="Jump exactly to hook start">Go</button><button data-hook-rename="${esc(h.id)}" title="Rename this hook">Rename</button>
        <input id="endLine-${esc(h.id)}" aria-label="Hook ending lyric" placeholder="End line" value="${esc(h.endLyric||"")}" style="width:110px;padding:6px;font-size:10px">
        <button data-hook-end="${esc(h.id)}" title="Capture the current song time as hook end">Mark end</button>
        ${h.source==="auto"?`<button data-hook-verify="${esc(h.id)}" title="Save and verify this generated hook">Save hook</button>`:""}
        <button data-hook-delete="${esc(h.id)}" title="Delete hook">×</button>
      </div>
    </div>`;
  }).join("");
  $("#hooksList").querySelectorAll("[data-hook-go]").forEach(b=>b.onclick=()=>playHookDirect(hooks.find(h=>String(h.id)===b.dataset.hookGo)));
  $("#hooksList").querySelectorAll("[data-hook-rename]").forEach(b=>b.onclick=()=>renameHook(b.dataset.hookRename));
  $("#hooksList").querySelectorAll("[data-hook-target]").forEach(b=>b.onclick=()=>{
    S.hookEditTarget[b.dataset.hookTarget]=b.dataset.target; renderHooks();
  });
  $("#hooksList").querySelectorAll("[data-hook-adjust]").forEach(b=>b.onclick=()=>
    adjustHookTime(b.dataset.hookAdjust,Number(b.dataset.delta),b.dataset.target)
  );
  $("#hooksList").querySelectorAll("[data-hook-end]").forEach(b=>b.onclick=()=>markHookEnd(b.dataset.hookEnd));
  $("#hooksList").querySelectorAll("[data-hook-verify]").forEach(b=>b.onclick=()=>verifyAutoHook(b.dataset.hookVerify));
  $("#hooksList").querySelectorAll("[data-hook-delete]").forEach(b=>b.onclick=()=>deleteHook(b.dataset.hookDelete));
  renderAIHookSuggestions();
}

// ---------- Hook fairness + remembered transitions ----------
function markHookPlayed(track, hook) {
  const key=hookKey(track,hook);
  S.hookPlays[key]=(S.hookPlays[key]||0)+1;
  S.trackPlays[track.id]=(S.trackPlays[track.id]||0)+1;
  save();
}
function preferredHooks(track) {
  const all=hooksOf(track);
  if(!settings.autoHookDetection) return all.filter(h=>h.source!=="auto");
  const manual=all.filter(h=>h.source!=="auto");
  return manual.length ? manual : all;
}
function fairHook(track) {
  const hooks=preferredHooks(track); if(!hooks.length) return null;
  const counts=hooks.map(h=>S.hookPlays[hookKey(track,h)]||0);
  const min=Math.min(...counts);
  const pool=hooks.filter(h=>(S.hookPlays[hookKey(track,h)]||0)===min);
  return pool[Math.floor(Math.random()*pool.length)];
}
function verifiedRandomHook(track) {
  const verified=hooksOf(track).filter(h=>h.source!=="auto");
  if(!verified.length) return null;
  return verified[Math.floor(Math.random()*verified.length)];
}
function rememberPattern(from,to,hook) {
  if(!from || !to || from.id===to.id) return;
  const hookId=hook?.id ?? null;
  const found=S.patterns.find(p=>p.from===from.id && p.to===to.id && String(p.hookId??"")===String(hookId??""));
  if(found) found.count++;
  else S.patterns.push({from:from.id,to:to.id,hookId,hookT:hook?.t??null,label:hook?.lyric||"Song transition",count:1});
  if(S.patterns.length>500) S.patterns.sort((a,b)=>b.count-a.count).length=500;
  save();
}
function rememberedFor(track) {
  return S.patterns.filter(p=>p.from===track?.id).sort((a,b)=>b.count-a.count);
}
function pickNextTrack() {
  const current=cur();
  if(S.queue.length) {
    // Explicit Play next always takes priority, even when shuffle is enabled.
    if(S.idx+1<S.queue.length) return S.queue[S.idx+1];
    if(S.shuffle) {
      const candidates=S.queue.map((t,i)=>({t,i})).filter(x=>x.i!==S.idx);
      if(candidates.length) return candidates[Math.floor(Math.random()*candidates.length)].t;
    } else if(S.idx+1<S.queue.length) return S.queue[S.idx+1];
  }
  const pool=S.lib.filter(f=>"my:"+f.file!==current?.id);
  if(!pool.length) return null;
  // Randomise across the full available library, while avoiding immediate repeats.
  const least=Math.min(...pool.map(f=>S.trackPlays["my:"+f.file]||0));
  const fair=pool.filter(f=>(S.trackPlays["my:"+f.file]||0)===least);
  return toTrack(fair[Math.floor(Math.random()*fair.length)]);
}
function ensureQueued(track) {
  let i=S.queue.findIndex(x=>x.id===track.id);
  if(i<0) { S.queue.splice(Math.max(0,S.idx+1),0,track); i=Math.max(0,S.idx+1); }
  return i;
}
function mixStartForHook(hook) {
  const lead=Math.max(0,(S.currentCrossfadeSeconds ?? mixSec())-settings.leadSubtract);
  return Math.max(0,hook.t-lead);
}

// ---------- Mix choice dialog ----------
function openMixChoices() {
  const from=cur(); if(!from) return toast("Play a track first.");
  const nextTrack=pickNextTrack();
  if(!nextTrack) return toast("Add songs to your library first.");
  const hooks=hooksOf(nextTrack);
  if(!hooks.length) {
    toast(`No saved hooks for ${nextTrack.title}; starting at ${settings.noHookStartSeconds} seconds.`);
    transitionTo(nextTrack,null,{manual:true,mode:"no-hook"});
    return;
  }
  const patterns=rememberedFor(from).filter(p=>p.to===nextTrack.id);
  const root=$("#modalRoot");
  const hookChoices=hooks.length ? hooks.map(h=>{
    const remembered=patterns.some(p=>String(p.hookId)===String(h.id));
    return `<button class="choice-row" data-mix-hook="${esc(h.id)}">
      <span class="choice-main"><b>${esc(h.lyric||"Saved hook")}</b><small>Hook at ${fmt(h.t)} · ${h.end!=null?"End "+fmt(h.end):"No end marked"}</small></span>
      ${remembered?'<span class="pattern-tag">REMEMBERED</span>':""}
      <span class="choice-time">Start ${fmt(mixStartForHook(h))}</span>
    </button>`;
  }).join("") : "";
  root.innerHTML=`<div class="modal-backdrop" data-dismiss="1"><div class="modal-card">
    <div class="modal-head"><div><div class="eyebrow">MANUAL TRANSITION</div><h2>Choose the next hook</h2><p class="modal-sub">Next: ${esc(nextTrack.title)} · ${esc(nextTrack.artist)}. The song starts early so its hook lands during the crossfade.</p></div><button class="modal-close" data-dismiss="1">×</button></div>
    <div class="choice-list">${hookChoices || '<div class="empty-state">This track has no saved hooks.</div>'}
      <button class="choice-row" data-mix-start="0"><span class="choice-main"><b>Start from beginning</b><small>No hook cue point</small></span><span class="choice-time">0:00</span></button>
    </div>
  </div></div>`;
  root.querySelectorAll("[data-dismiss]").forEach(b=>b.onclick=e=>{if(e.target===b)root.innerHTML="";});
  root.querySelectorAll("[data-mix-hook]").forEach(b=>b.onclick=()=>{
    const h=hooks.find(x=>String(x.id)===b.dataset.mixHook);
    root.innerHTML=""; if(h) transitionTo(nextTrack,h,{manual:true});
  });
  root.querySelector("[data-mix-start]").onclick=()=>{root.innerHTML="";transitionTo(nextTrack,null,{manual:true});};
}

// ---------- Party mode motion + rotating brand line ---------- 
let partyTaglineTimer=null;
const PARTY_TAGLINES=["IS YOUR DJ","BY KUSHAGRA","AI IS YOUR DJ TONIGHT","LET'S PARTY"];
let partyTaglineIndex=0;
function startPartyBrandLoop(){
  const tagline=$("#partyTagline"), wave=$("#partySoundwave");
  if(!tagline) return;
  clearInterval(partyTaglineTimer);
  partyTaglineIndex=0;
  tagline.textContent=PARTY_TAGLINES[partyTaglineIndex];
  tagline.classList.remove("tagline-change");
  if(wave && !wave.childElementCount){
    const bars=Array.from({length:64},(_,i)=>{
      const peaks=[.10,.29,.43,.58,.73,.91];
      const envelope=Math.max(.09,...peaks.map((p,j)=>Math.exp(-Math.pow((i/63-p)/(j%2?.055:.085),2))*(.62+(j%3)*.12)));
      const texture=.58+.42*Math.abs(Math.sin(i*2.17));
      const h=Math.round(8+envelope*texture*92);
      const delay=(-Math.abs(Math.sin(i*1.71))*1.25).toFixed(2);
      const speed=(.48+Math.abs(Math.sin(i*.83))*.78).toFixed(2);
      return '<i style="--wave-h:'+h+'%;--wave-delay:'+delay+'s;--wave-speed:'+speed+'s"></i>';
    }).join("");
    wave.innerHTML=bars;
  }
  partyTaglineTimer=setInterval(()=>{
    if($("#partyMode")?.hidden){clearInterval(partyTaglineTimer);partyTaglineTimer=null;return;}
    partyTaglineIndex=(partyTaglineIndex+1)%PARTY_TAGLINES.length;
    tagline.classList.remove("tagline-change");
    tagline.textContent=PARTY_TAGLINES[partyTaglineIndex];
    void tagline.offsetWidth;
    tagline.classList.add("tagline-change");
  },2500);
}
function stopPartyBrandLoop(){clearInterval(partyTaglineTimer);partyTaglineTimer=null;}
function syncPartyMotion(){
  const stage=$("#partyMode .party-stage");
  if(!stage)return;
  stage.classList.toggle("dj-active",!audio().paused);
  stage.classList.toggle("dj-mixing",!!(S.mixing||S.transitioning));
}

// ---------- Transition animation + two-deck playback ----------
function showPartyMessage(message) {
  const el=$("#partyMessage");
  if(el) { el.textContent=message; el.classList.remove("party-message-pop"); void el.offsetWidth; el.classList.add("party-message-pop"); }
}
function setDJActivity(title,detail,countdown="--:--",state="ready") {
  const titleEl=$("#djActivity"), detailEl=$("#djDetail"), countEl=$("#djCountdown");
  if(titleEl) titleEl.textContent=title;
  if(detailEl) detailEl.textContent=detail;
  if(countEl) countEl.textContent=countdown;
  const panel=$(".wave-panel");
  if(panel) panel.dataset.djState=state;
  syncPartyMotion();
  if($("#partyMode") && !$("#partyMode").hidden) {
    $("#partyActivity").textContent=title;
    $("#partyDetail").textContent=detail;
    if(/SCAN|FINDING/.test(title)) showPartyMessage("Finding the hook line… 🎧");
    else if(/HOOK FOUND|HOOK LINE FOUND/.test(title)) showPartyMessage("Hook line found. Bass drop on the way! 🔊");
    else if(/CROSSFADING|MIXING/.test(title)) showPartyMessage("Ye hogyi mixing! Ab vibe dekho. 🪩");
    else if(/DROP|YEAHHH/.test(title)) showPartyMessage("Ab pata hai kya song aane wala hai? LET’S NACHOOOO! 💃");
    else if(/NO STRONG MATCH|UNAVAILABLE/.test(title)) showPartyMessage("Surprise incoming — letting the beat speak. ✨");
  }
}
function updateDJStatus() {
  const t=cur(), a=audio();
  if(!t) { setDJActivity("AWAITING SIGNAL","Load a track and the DJ engine will lock onto its rhythm."); return; }
  const upcoming=S.queue[S.idx+1]||null;
  maybeAutoScanUpcoming(upcoming);
  if(upcoming && S.autoHookInFlight.has(upcoming.id)) {
    setDJActivity("AUTO SCAN · NEXT TRACK","Analysing "+upcoming.title+" for repeated sections and high-energy hooks","SCAN","sync");
    return;
  }
  const chosen=upcoming && upcoming._chosenHook;
  if(S.transitioning) {
    setDJActivity("LOCKING NEXT TRACK","Preparing "+(upcoming?.title||t.title)+" · buffering audio and cue points…","SYNC","sync");
    return;
  }
  if(S.mixing) {
    setDJActivity("CROSSFADING · LIVE","Blending "+t.title+" into the next track. Keep the energy up!","LIVE","mix");
    return;
  }
  if(a.paused) {
    setDJActivity("ENGINE PAUSED","Playback is paused. Your next cue is safely waiting.","PAUSED","paused");
    return;
  }
  const hook=S.activeHook?.trackId===t.id?S.activeHook:null;
  const approvedEnd=hook && hook.endSource==="manual" && hook.end!=null && Number.isFinite(Number(hook.end)) ? Number(hook.end) : null;
  const deadline=hook?(approvedEnd??(hook.t+settings.hookPlaySeconds)):(S.activeNoHookDeadline?.trackId===t.id?S.activeNoHookDeadline.at:settings.noHookSeconds);
  const resetCountdown=approvedEnd!=null ? null : (S.seeking
    ? S.seekResetDelay
    : (S.seekResumeAt ? S.seekResetDelay-(a.currentTime-S.seekResetMediaTime) : null));
  const left=Math.max(0,resetCountdown==null?deadline-a.currentTime:resetCountdown);
  const clock=String(Math.floor(left/60)).padStart(2,"0")+":"+String(Math.floor(left%60)).padStart(2,"0");
  const nextName=upcoming?.title||"next random pick";
  if(approvedEnd!=null) {
    setDJActivity("HOOK ENDING FOUND","Hook ending saved · merging to next song from "+fmt(approvedEnd),"HOOK END","ready");
  } else if(chosen) {
    if(left<=8) setDJActivity("BEAT SYNC · HOOK LOCKED","Lining up “"+(chosen.lyric||"your selected hook")+"” on "+nextName+". Get ready!",clock,"sync");
    else setDJActivity("HOOK LOCKED · READY","Next: "+nextName+" · “"+(chosen.lyric||"selected hook")+"” at "+fmt(chosen.t),clock,"ready");
  } else if(upcoming && hooksOf(upcoming).length) {
    if(left<=8) setDJActivity("SYNCING THE BEAT","Scanning "+hooksOf(upcoming).length+" saved hooks for "+nextName+" · transition imminent",clock,"sync");
    else setDJActivity("HOOKS DETECTED",hooksOf(upcoming).length+" saved cue point(s) ready on "+nextName+" · lining up the next mix",clock,"ready");
  } else if(left<=8) {
    setDJActivity("COUNTDOWN · DROP INCOMING","No saved hook on the next track · preparing the "+settings.noHookStartSeconds+"s fallback start",clock,"sync");
  } else {
    setDJActivity("AUTO MIX READY","Playing "+t.title+" · next transition in "+clock+" · scanning your music library",clock,"ready");
  }
}
function showTransition(track,hook,automatic=true) {
  const banner=$("#transitionBanner");
  $("#transitionTitle").textContent="DJ ENGINE · PREPARING THE DROP";
  $("#transitionText").textContent=hook
    ? "Hook found: “"+(hook.lyric||"Saved hook")+"” at "+fmt(hook.t)+". Locking the cue and beat…"
    : "No hook found. Loading the "+settings.noHookStartSeconds+"s fallback start for "+track.title+"…";
  $("#transitionCaption").textContent="Next: "+track.title;
  $("#engineState").textContent="SYNCING";
  setDJActivity(hook?"HOOK FOUND · LOCKING CUE":"TRACK FOUND · LOADING",hook
    ? "“"+(hook.lyric||"Saved hook")+"” selected · calculating transition timing"
    : "Preparing "+track.title+" from "+settings.noHookStartSeconds+"s · beat sync in progress","SYNC","sync");
  banner.classList.add("show");
  clearTimeout(showTransition.timer);
  showTransition.timer=setTimeout(()=>{banner.classList.remove("show");$("#engineState").textContent="READY";updateDJStatus();},Math.max(1800,(S.currentCrossfadeSeconds ?? mixSec())*1000+500));
}
function fade(el,to,ms,done) {
  clearInterval(el._fade);
  const from=el.volume, start=performance.now();
  el._fade=setInterval(()=>{
    const p=Math.min(1,(performance.now()-start)/ms);
    el.volume=Math.max(0,Math.min(1,from+(to-from)*p));
    if(p>=1){clearInterval(el._fade);done?.();}
  },35);
}
// Equal-power crossfade avoids the perceived volume dip of two linear fades.
function equalPowerCrossfade(outgoing,incoming,ms,onDone) {
  clearInterval(outgoing._fade); clearInterval(incoming._fade);
  const started=performance.now(), outStart=outgoing.volume, inEnd=vol();
  const tick=()=>{
    const p=Math.min(1,(performance.now()-started)/Math.max(1,ms));
    outgoing.volume=Math.max(0,Math.min(1,outStart*Math.cos(p*Math.PI/2)));
    incoming.volume=Math.max(0,Math.min(1,inEnd*Math.sin(p*Math.PI/2)));
    if(p>=1){
      clearInterval(outgoing._fade); clearInterval(incoming._fade);
      outgoing.volume=0; incoming.volume=inEnd; onDone?.();
    }
  };
  outgoing._fade=setInterval(tick,25);
  incoming._fade=outgoing._fade;
}
async function waitMetadata(el) {
  if(el.readyState>=1) return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();resolve();},7000);
    const cleanup=()=>{clearTimeout(timer);el.removeEventListener("loadedmetadata",ok);el.removeEventListener("error",bad);};
    const ok=()=>{cleanup();resolve();};
    const bad=()=>{cleanup();reject(new Error("Audio file could not be loaded"));};
    el.addEventListener("loadedmetadata",ok,{once:true});
    el.addEventListener("error",bad,{once:true});
  });
}
function fadeInDeck(deck,target=1,durationMs=2200) {
  clearInterval(deck._fade);
  const started=performance.now();
  deck.volume=0;
  deck._fade=setInterval(()=>{
    const progress=Math.min(1,(performance.now()-started)/durationMs);
    // Smooth ease-in curve; preserve the user's master-volume setting.
    deck.volume=Math.max(0,Math.min(1,target*(progress*progress*(3-2*progress))));
    if(progress>=1){clearInterval(deck._fade);deck._fade=null;deck.volume=target;}
  },40);
}
async function transitionTo(track,hook,{manual=false,automatic=false,mode=null,initialFade=false}={}) {
  if(!track || S.transitioning) return;
  S.transitioning=true;
  clearTimeout(S.transitionTimer);
  const previous=cur(), token=++S.tok;
  const idx=ensureQueued(track);
  S.idx=idx;
  clearTimeout(S.displayUpdateTimer);
  document.querySelector(".queue-list .track-row.current")?.classList.add("track-entering");
  $(".dj-upcoming")?.classList.add("upcoming-mixing");
  S.currentCrossfadeSeconds=chooseCrossfadeSeconds();
  updateCrossfadeIndicator();
  const startAt=hook ? mixStartForHook(hook,track) : ((automatic || mode==="no-hook") ? settings.noHookStartSeconds : 0);
  showTransition(track,hook,automatic);
  try {
    const url=await getUrl(track);
    if(token!==S.tok) return;
    const old=audio(), nextAudio=A[1-ci], wasPlaying=!old.paused;
    clearInterval(nextAudio._fade); nextAudio.pause(); nextAudio.src=url; nextAudio.volume=0;
    await waitMetadata(nextAudio);
    setDJActivity(hook?"HOOK FOUND · CUE LOCKED":"TRACK LOADED · NO HOOK",hook
      ? "“"+(hook.lyric||"Saved hook")+"” located · starting at "+fmt(startAt)+" to land on the drop"
      : "No saved hook · starting at "+fmt(startAt)+" as configured","SYNC","sync");
    if(startAt>0 && Number.isFinite(nextAudio.duration)) nextAudio.currentTime=Math.min(startAt,Math.max(0,nextAudio.duration-1));
    await nextAudio.play();
    if(token!==S.tok){nextAudio.pause();return;}
    ci=1-ci;
    if(S.currentCrossfadeSeconds===0) {
      // Crossfade disabled: switch decks instantly without overlapping audio.
      old.pause(); old.removeAttribute("src"); old.load();
      if(initialFade) fadeInDeck(nextAudio,vol()); else nextAudio.volume=vol(); S.mixing=false; S.transitioning=false; updateCrossfadeIndicator();
      $(".dj-upcoming")?.classList.remove("upcoming-mixing");
    } else {
      S.mixing=true; updateCrossfadeIndicator();
      if(wasPlaying) equalPowerCrossfade(old,nextAudio,S.currentCrossfadeSeconds*1000,()=>{
        old.pause();old.removeAttribute("src");old.load();
        S.mixing=false;S.transitioning=false;updateCrossfadeIndicator();$(".dj-upcoming")?.classList.remove("upcoming-mixing");
      });
      else {
        old.pause(); if(initialFade) fadeInDeck(nextAudio,vol()); else nextAudio.volume=vol();
        S.mixing=false; S.transitioning=false;
        $(".dj-upcoming")?.classList.remove("upcoming-mixing");
      }
    }
    S.activeHook=hook?{trackId:track.id,hookId:hook.id,t:hook.t,end:hook.end??null,source:hook.source??"manual",endSource:hook.endSource??null,endApproved:hook.endApproved===true||hook.endSource==="manual",lyric:hook.lyric||"Hook"}:null;
    S.activeTrackStartedAt={trackId:track.id,mediaTime:Number(nextAudio.currentTime)||0};
    renderHooks();
    S.activeNoHookDeadline=hook?null:{trackId:track.id,at:startAt+settings.noHookSeconds};
    if(hook) markHookPlayed(track,hook);
    if(previous) rememberPattern(previous,track,hook);
    setDJActivity(hook?"YEAHHH · HOOK DROP!":"NEW TRACK · LET’S GO!",hook
      ? "Now riding “"+(hook.lyric||"the hook")+"” · "+track.title
      : "Now playing "+track.title+" · keep the party moving","LIVE","mix");
    S.hist=[track,...S.hist.filter(x=>x.id!==track.id)].slice(0,100);
    S.songChanges=(S.songChanges||0)+1; if(S.songChanges%7===0) setTimeout(()=>maybeSurprisePunch(),Math.max(500,(S.currentCrossfadeSeconds||0)*1000+300));
    save();
    if(S.autoMix&&!S.training.active) ensureAutoMixNextTrack();
    if(settings.aiEnabled) suggest();
    scheduleTrackDisplayUpdate(token);
  } catch(e) {
    S.transitioning=false; S.mixing=false;
    if(token===S.tok) toast(`Couldn't play ${track.title}: ${e.message}`);
    render();
  }
}
async function randomEnergyStart(track) {
  const url=await getUrl(track);
  if(S.env[track.id]===undefined) {
    try { S.env[track.id]=await analyse(url); } catch { S.env[track.id]=null; }
  }
  return S.env[track.id]?pickStart(S.env[track.id],null):0;
}
async function analyse(url) {
  const buffer=await (await fetch(url)).arrayBuffer();
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await ctx.decodeAudioData(buffer);
  const data=decoded.getChannelData(0), sr=decoded.sampleRate, seconds=Math.floor(data.length/sr), env=[];
  for(let s=0;s<seconds;s++){
    let sum=0,count=0;
    for(let k=s*sr;k<(s+1)*sr;k+=8){sum+=data[k]*data[k];count++;}
    env.push(Math.sqrt(sum/Math.max(1,count)));
  }
  ctx.close();
  const max=Math.max(...env)||1;
  return env.map(v=>v/max);
}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function pickStart(env) {
  const w=8;if(env.length<w*3)return 0;
  let best=0,score=-1;
  for(let i=Math.floor(env.length*.1);i<Math.min(env.length*.65,env.length-w);i++){
    const value=avg(env.slice(i,i+w));
    if(value>score){score=value;best=i;}
  }
  return best;
}

// ---------- Auto DJ: fair hook rotation, no endless track ----------
function djCandidatePool() {
  let pool=S.lib.filter(f=>"my:"+f.file!==cur()?.id);
  const recent=new Set(S.hist.slice(0,4).map(t=>t.id));
  const fresh=pool.filter(f=>!recent.has("my:"+f.file));
  if(fresh.length) pool=fresh;
  if(!pool.length) return [];
  const least=Math.min(...pool.map(f=>S.trackPlays["my:"+f.file]||0));
  return pool.filter(f=>(S.trackPlays["my:"+f.file]||0)===least);
}
function pickRandomDJTrack() {
  const pool=djCandidatePool();
  return pool.length ? toTrack(pool[Math.floor(Math.random()*pool.length)]) : null;
}
// Estimate tempo locally from onset-strength autocorrelation; no external API.
async function estimateTrackBpm(track) {
  if(!track) return null;
  if(Number.isFinite(Number(track.mixAnalysis?.bpm)) && Number(track.mixAnalysis?.bpmConfidence||0)>=0.12) return Number(track.mixAnalysis.bpm);
  const cached=S.bpmCache[track.id];
  if(track.provider!=="mine") return null;
  if(cached && Number.isFinite(cached.bpm)) return cached.bpm;
  const url=await getUrl(track);
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  try {
    const bytes=await (await fetch(url)).arrayBuffer();
    const decoded=await ctx.decodeAudioData(bytes);
    const channel=decoded.getChannelData(0), sr=decoded.sampleRate;
    const sampleRate=100, hop=Math.max(1,Math.floor(sr/sampleRate));
    const frames=Math.min(Math.floor(channel.length/hop),4500), energy=new Float32Array(frames);
    for(let i=0;i<frames;i++){
      const start=i*hop, end=Math.min(channel.length,start+hop);
      let sum=0;
      for(let j=start;j<end;j+=4) sum+=channel[j]*channel[j];
      energy[i]=Math.sqrt(sum/Math.max(1,Math.ceil((end-start)/4)));
    }
    const onset=new Float32Array(frames);
    for(let i=1;i<frames;i++) onset[i]=Math.max(0,energy[i]-energy[i-1]);
    const mean=onset.reduce((a,b)=>a+b,0)/Math.max(1,frames);
    for(let i=0;i<frames;i++) onset[i]=Math.max(0,onset[i]-mean);
    let bestLag=0,bestScore=-Infinity;
    for(let bpm=70;bpm<=180;bpm++){
      const lag=Math.round(sampleRate*60/bpm);
      let score=0, norm=0;
      for(let i=lag;i<frames;i++){score+=onset[i]*onset[i-lag];norm+=onset[i]*onset[i];}
      score/=Math.max(1e-9,norm);
      if(score>bestScore){bestScore=score;bestLag=lag;}
    }
    if(!bestLag || bestScore<0.015) return null;
    const bpm=Math.round(sampleRate*60/bestLag);
    S.bpmCache[track.id]={bpm,at:Date.now()};
    store.set("bpmCache",S.bpmCache);
    return bpm;
  } catch(error) {
    console.warn("BPM analysis failed for",track.title,error);
    return null;
  } finally { try{await ctx.close();}catch{} }
}
async function pickBpmMatchedDJTrack() {
  const pool=djCandidatePool();
  if(!pool.length) return null;
  const current=cur();
  const currentBpm=await estimateTrackBpm(current);
  if(!currentBpm) {
    setDJActivity("BPM SCAN UNAVAILABLE","Keeping the random DJ rotation; tempo analysis could not read this track","READY","ready");
    return toTrack(pool[Math.floor(Math.random()*pool.length)]);
  }
  // Analyse a small random candidate sample to keep transition preparation responsive.
  const sample=[...pool].sort(()=>Math.random()-.5).slice(0,Math.min(10,pool.length));
  const measured=[];
  for(const file of sample){
    const track=toTrack(file), bpm=await estimateTrackBpm(track);
    if(bpm) measured.push({track,bpm,diff:Math.abs(bpm-currentBpm)});
  }
  if(!measured.length) return toTrack(pool[Math.floor(Math.random()*pool.length)]);
  const within=measured.filter(x=>x.diff<=settings.bpmTolerance);
  let selected;
  if(within.length){
    const closest=Math.min(...within.map(x=>x.diff));
    const ties=within.filter(x=>x.diff<=closest+1);
    selected=ties[Math.floor(Math.random()*ties.length)];
  } else {
    selected=measured.reduce((a,b)=>b.bpm<a.bpm?b:a);
    setDJActivity("BPM FALLBACK · LOWEST TEMPO","No track within ±"+settings.bpmTolerance+" BPM of "+currentBpm+" BPM · choosing the lowest analysed tempo ("+selected.bpm+" BPM)","SYNC","sync");
  }
  if(within.length) setDJActivity("BPM MATCH LOCKED",currentBpm+" BPM → "+selected.bpm+" BPM · closest available tempo","READY","ready");
  return selected.track;
}
function ensureAutoMixNextTrack() {
  if(!S.autoMix || !cur() || S.queue[S.idx+1]) return Promise.resolve(null);
  if(S.autoMixNextPromise) return S.autoMixNextPromise;
  S.autoMixNextPromise=(async()=>{
    try {
      const nextTrack=await pickBpmMatchedDJTrack();
      if(nextTrack && S.autoMix && !S.queue[S.idx+1]) addQueue(nextTrack,"next");
      return nextTrack;
    } finally { S.autoMixNextPromise=null; }
  })();
  return S.autoMixNextPromise;
}

function trainingRandomTrack(excludeId=null){const p=S.lib.filter(f=>"my:"+f.file!==excludeId);if(!p.length)return null;const recent=new Set(S.hist.slice(0,3).map(x=>x.id));const f=p.filter(x=>!recent.has("my:"+x.file));const a=f.length?f:p;return toTrack(a[Math.floor(Math.random()*a.length)]);}
function trainingRandomHook(track){const h=hooksOf(track);return h.length?h[Math.floor(Math.random()*h.length)]:null;}
async function trainingPrepareTrack(track){if(track?.provider==="mine"&&!hooksOf(track).length&&!S.hookScans[track.id])await scanCurrentSongHooks({automatic:true,trackOverride:track});const h=trainingRandomHook(track);if(!h)return null;return {...h,t:Math.max(0,h.t+window.VibeLearningModel.getOffset(track,h,"incoming")),end:h.end!=null?Math.max(0,h.end+window.VibeLearningModel.getOffset(track,h,"outgoing")):h.end};}
function trainingRefreshStats(){const s=window.VibeLearningModel.stats();$("#trainingScore").textContent=(s.score>0?"+":"")+s.score;$("#trainingCount").textContent=s.transitions;$("#trainingOutAccuracy").textContent=s.outgoingCount?s.outgoingCount+" ratings":"—";$("#trainingInAccuracy").textContent=s.incomingCount?s.incomingCount+" ratings":"—";}
function trainingSetUi(on,msg=""){ $("#trainingState").textContent=on?"TRAINING ACTIVE":"TRAINING OFF";$("#trainingState").classList.toggle("active",on);$("#startTraining").disabled=on;$("#stopTraining").disabled=!on;$("#trainingMessage").textContent=msg||(on?"Random hook transitions · feedback after 5 seconds":"Training is independent of normal Auto Mix.");}
async function startTraining(){if(S.training.active)return;if(S.lib.length<2)return toast("Add at least two songs to My music before training.");S.training.originalDetection=settings.autoHookDetection;S.training.originalMode=settings.autoMode;S.training.originalAutoMix=S.autoMix;S.training.active=true;S.training.pending=null;settings.autoHookDetection=true;settings.autoMode="hook";S.autoMix=true;store.set("autoMix",true);syncControls();trainingSetUi(true,"Preparing a random training track…");const t=trainingRandomTrack(cur()?.id);if(!t){stopTraining();return toast("No eligible training track found.");}try{const h=await trainingPrepareTrack(t);if(!S.training.active)return;transitionTo(t,h,{automatic:true,mode:"hook"});trainingSetUi(true,"Training is running. Feedback appears 5 seconds after each transition.");}catch(e){stopTraining();toast("Training could not start: "+e.message);}}
function stopTraining(){if(!S.training.active)return;clearTimeout(S.training.feedbackTimer);S.training.active=false;S.training.pending=null;settings.autoHookDetection=S.training.originalDetection;settings.autoMode=S.training.originalMode;S.autoMix=S.training.originalAutoMix;store.set("autoMix",S.autoMix);$("#modalRoot").innerHTML="";syncControls();trainingSetUi(false,"Training stopped. Learned scores and timing adjustments are saved.");render();}
function trainingFeedbackDialog(){if(!S.training.active||!S.training.pending)return;const p=S.training.pending,r=$("#modalRoot"),o=[["e2","2s too early",-2,2],["e1","1s too early",-1,1],["ok","Perfect",2,0],["l1","1s too late",-1,-1],["l2","2s too late",-2,-2]];const group=(s,title,t,h)=>"<section class=\"training-rating-group\"><h3>"+title+"</h3><p class=\"modal-sub\">"+esc(t?.title||"Song")+" · "+esc(h?.lyric||"Hook")+"</p><div class=\"training-rating-options\">"+o.map(x=>"<button type=\"button\" class=\"quiet-btn\" data-rate=\""+s+"\" data-v=\""+x[0]+"\">"+x[1]+"</button>").join("")+"</div></section>";r.innerHTML="<div class=\"modal-backdrop\"><div class=\"modal-card training-feedback\"><div class=\"modal-head\"><div><div class=\"eyebrow\">TRAINING FEEDBACK</div><h2>How did that mix feel?</h2><p class=\"modal-sub\">Rate both cue positions. Feedback updates future timing.</p></div></div>"+group("out","1 · Previous song ending",p.fromTrack,p.fromHook)+group("in","2 · New song starting",p.toTrack,p.toHook)+"<div class=\"training-feedback-actions\"><button id=\"stopFromFeedback\" class=\"quiet-btn\">Stop training</button><button id=\"saveTrainingFeedback\" class=\"primary-btn\" disabled>Save feedback & continue</button></div></div></div>";const chosen={};r.querySelectorAll("[data-rate]").forEach(b=>b.onclick=()=>{const side=b.dataset.rate;chosen[side]=o.find(x=>x[0]===b.dataset.v);r.querySelectorAll("[data-rate=\""+side+"\"]").forEach(x=>x.classList.toggle("selected",x===b));$("#saveTrainingFeedback").disabled=!(chosen.out&&chosen.in);});$("#stopFromFeedback").onclick=stopTraining;$("#saveTrainingFeedback").onclick=()=>{if(!chosen.out||!chosen.in)return;const stats=window.VibeLearningModel.record(p.fromTrack,p.fromHook,p.toTrack,p.toHook,{score:chosen.out[2],adjust:chosen.out[3]},{score:chosen.in[2],adjust:chosen.in[3]});S.training.pending=null;r.innerHTML="";trainingRefreshStats();trainingSetUi(true,"Feedback saved · overall score "+(stats.score>0?"+":"")+stats.score);audio().play().catch(()=>toast("Press Play to resume training."));};}
function trainingScheduleFeedback(ft,fh,tt,th){if(!S.training.active)return;S.training.pending={fromTrack:ft,fromHook:fh,toTrack:tt,toHook:th};const wait=()=>{if(!S.training.active||!S.training.pending)return;if(S.mixing||S.transitioning){S.training.feedbackTimer=setTimeout(wait,200);return;}S.training.feedbackTimer=setTimeout(()=>{if(!S.training.active||!S.training.pending)return;audio().pause();trainingSetUi(true,"Playback paused for your transition ratings.");trainingFeedbackDialog();},5000);};wait();}
async function trainingNextAutomatic(){if(!S.training.active||S.transitioning||S.training.pending||S.training.busy)return;S.training.busy=true;try{const ft=cur(),fh=S.activeHook?{...S.activeHook}:null,t=trainingRandomTrack(ft?.id);if(!t){stopTraining();return toast("Training needs at least two available songs.");}const h=await trainingPrepareTrack(t);if(!S.training.active)return;transitionTo(t,h,{automatic:true,mode:h?"hook":"beginning"});trainingScheduleFeedback(ft,fh,t,h);}finally{S.training.busy=false;}}
async function nextAutomatic() {
  if(S.training.active) return trainingNextAutomatic();
  if (!S.autoMix || S.transitioning || S.autoTransitionPending) return;
  S.autoTransitionPending=true;
  try {
    // A manually queued track always has priority; otherwise choose the best BPM match.
    let queuedNext=S.queue[S.idx+1]||null;
    if(!queuedNext) {
      await ensureAutoMixNextTrack();
      queuedNext=S.queue[S.idx+1]||null;
    }
    if(settings.autoMode==="hook" && queuedNext && S.autoHookInFlight.has(queuedNext.id) &&
      Date.now()-(S.autoHookStartedAt[queuedNext.id]||Date.now())<15000) {
      setDJActivity("WAITING FOR HOOK SCAN","Letting the local scanner finish on "+queuedNext.title+" before the drop","SCAN","sync");
      return;
    }
    let track=queuedNext||await pickBpmMatchedDJTrack();
    if(!track) { toast("Add more tracks to My music for automatic mixing."); return; }

    // From beginning deliberately skips hook analysis. From hook scans only when needed.
    if(settings.autoMode==="hook" && track.provider==="mine" && !hooksOf(track).length && !S.hookScans[track.id]) {
      setDJActivity("FINDING HOOK LINE","Analysing "+track.title+" before playback · no saved hook is available","SCAN","sync");
      showPartyMessage("Finding the hook line… 🎧");
      await scanCurrentSongHooks({automatic:true,trackOverride:track});
    }
    if(!S.autoMix || S.transitioning) return;

    const chosen=queuedNext?._chosenHook||null;
    const punchCue=queuedNext?._chosenPunch||null;
    const availableHooks=preferredHooks(track);
    const chosenHook=chosen ? availableHooks.find(h=>String(h.id)===String(chosen.id)) : null;
    const hook=punchCue?(chosenHook||availableHooks.find(h=>String(h.id)===String(punchCue.triggerHookId||""))||{id:punchCue.id,t:punchCue.start,end:punchCue.end,lyric:"Saved punch",source:"manual"}):(settings.autoMode==="beginning" ? null : (chosenHook || (availableHooks.length ? fairHook(track) : null)));
    if(chosen) { delete track._chosenHook; save(); }
    if(punchCue){delete track._chosenPunch;save();}
    if(hook) {
      setDJActivity("HOOK LINE FOUND · MIXING NOW","Cue locked on "+track.title+" · preparing the drop","READY","ready");
      showPartyMessage("Hook line found. Bass drop on the way! 🔊");
    } else if(settings.autoMode==="hook") {
      showPartyMessage("No hook found — bringing the track in from your fallback point.");
    }
    transitionTo(track,hook,{automatic:true,mode:hook?"hook":"beginning"});
  } finally { S.autoTransitionPending=false; }
}
function handleAutoAdvance() {
  if (!automaticSwitchingEnabled() || S.transitioning || S.mixing) return;
  nextAutomatic();
}
function seekResetDuration() {
  const t=cur(), h=S.activeHook && S.activeHook.trackId===t?.id ? S.activeHook : null, a=audio();
  if(h && h.source!=="auto" && h.endSource==="manual" && h.end!=null && Number.isFinite(Number(h.end))) return Math.max(0,Number(h.end)-a.currentTime);
  const started=S.activeTrackStartedAt?.trackId===t?.id?S.activeTrackStartedAt.mediaTime:a.currentTime;
  const minimum=Math.max(5,Number(settings.minTrackPlaySeconds)||40);
  const cueDeadline=h?h.t+settings.hookPlaySeconds:(S.activeNoHookDeadline?.at??(started+settings.noHookSeconds));
  return Math.max(0,Math.max(started+minimum,cueDeadline)-a.currentTime);
}
function checkHookTimer() {
  if (!automaticSwitchingEnabled()) return;
  const t=cur(), a=audio();
  if(!t || a.paused || S.transitioning || S.mixing || S.seeking || (S.training.active&&S.training.pending)) return;
  if(S.seekResumeAt) {
    if(a.currentTime-S.seekResetMediaTime>=S.seekResetDelay) { S.seekResumeAt=0; handleAutoAdvance(); }
    return;
  }
  const h=S.activeHook && S.activeHook.trackId===t.id ? S.activeHook : null;
  const started=S.activeTrackStartedAt?.trackId===t.id?S.activeTrackStartedAt.mediaTime:a.currentTime;
  const minimumDeadline=started+Math.max(5,Number(settings.minTrackPlaySeconds)||40);
  if(h) {
    const manuallySavedEnd=h.source!=="auto" && h.endSource==="manual" && h.end!==null && h.end!==undefined && Number.isFinite(Number(h.end));
    const learnedEnd=S.training.active?window.VibeLearningModel.getOffset(t,{id:h.hookId,t:h.t},"outgoing"):0;
    const cueDeadline=h.t+settings.hookPlaySeconds+learnedEnd;
    const deadline=manuallySavedEnd?Number(h.end):Math.max(minimumDeadline,cueDeadline);
    if(a.currentTime>=deadline) handleAutoAdvance();
  } else {
    const fallback=S.activeNoHookDeadline?.trackId===t.id?S.activeNoHookDeadline.at:started+settings.noHookSeconds;
    if(a.currentTime>=Math.max(minimumDeadline,fallback)) handleAutoAdvance();
  }
}

// ---------- Queue ----------
function addQueue(track,where="end") {
  if(!track || track.id===cur()?.id) return;
  const existing=S.queue.findIndex(x=>x.id===track.id);
  if(existing>=0) {
    if(where!=="next") return;
    const [item]=S.queue.splice(existing,1);
    if(existing<S.idx) S.idx--;
    S.queue.splice(Math.max(0,S.idx+1),0,item);
  } else if(where==="next") S.queue.splice(Math.max(0,S.idx+1),0,track);
  else S.queue.push(track);
  save(); render();
}
function removeQueue(i) {
  if(i<S.idx) S.idx--;
  else if(i===S.idx) { S.queue.splice(i,1); S.idx=Math.min(S.idx,S.queue.length-1); }
  else S.queue.splice(i,1);
  save(); render();
}
function reorderQueue(from,to) {
  if(from===to || from<0 || to<0 || from>=S.queue.length || to>=S.queue.length)return;
  const [item]=S.queue.splice(from,1); S.queue.splice(to,0,item);
  if(S.idx===from) S.idx=to;
  else if(from<S.idx && to>=S.idx) S.idx--;
  else if(from>S.idx && to<=S.idx) S.idx++;
  save(); render();
}
function playTrack(track) {
  const i=ensureQueued(track);
  const hook=hooksOf(track).length?fairHook(track):null;
  transitionTo(track,hook,{manual:true});
}
function next() {
  const t=pickNextTrack();
  if(!t) return toast("No next track. Add songs to your library.");
  const hook=settings.autoMode==="beginning"?null:fairHook(t);
  transitionTo(t,hook,{automatic:true,mode:settings.autoMode});
}
function previous() {
  if(audio().currentTime>5){audio().currentTime=0;return;}
  if(S.hist.length>1){
    const t=S.hist[1];
    const hook=hooksOf(t).length?fairHook(t):null;
    transitionTo(t,hook,{manual:true});
  }
}
function mixNext() { openMixChoices(); }
function forceMixNow() {
  const nextTrack=S.queue[S.idx+1] || pickNextTrack();
  if(!nextTrack) return toast("Add a song to the queue first.");
  const chosen=nextTrack._chosenHook;
  const hook=chosen
    ? (hooksOf(nextTrack).find(h=>String(h.id)===String(chosen.id)) || chosen)
    : (hooksOf(nextTrack).length ? fairHook(nextTrack) : null);
  if(chosen) { delete nextTrack._chosenHook; save(); }
  transitionTo(nextTrack,hook,{manual:true,mode:hook?"hook":"no-hook"});
}

// ---------- AI recommendations (fully disabled by toggle) ----------
async function suggest() {
  if(!settings.aiEnabled || !cur() || S.busy) return;
  S.busy=true;
  try {
    const current=cur();
    const lists=await Promise.all([
      api("audius-search?mode=trending").catch(()=>({tracks:[]})),
      ...(current.provider==="mine"?[]:[current.artist,current.genre].filter(Boolean).map(q=>api("audius-search?q="+encodeURIComponent(q)).catch(()=>({tracks:[]}))) )
    ]);
    const seen=new Set([current.id,...S.queue.map(x=>x.id),...S.hist.slice(0,10).map(x=>x.id)]);
    const mine=S.lib.map(toTrack).filter(t=>!seen.has(t.id));
    const candidates=[...mine,...lists.flatMap(x=>x.tracks||[])].filter(t=>!seen.has(t.id)&&seen.add(t.id)).slice(0,30);
    if(!candidates.length) return;
    const d=await api("ai-recommend",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({current,recent:S.hist.slice(0,10),likes:S.favs.map(x=>x.artist),candidates})});
    S.recs=d.recommendations||[];
    renderRecommendations();
  } catch(e) {
    if(settings.aiEnabled) console.warn("AI recommendations unavailable:",e);
  } finally { S.busy=false; }
}

// ---------- Audius search ----------
async function searchAudius(q="") {
  S.view="discover"; $("#pageTitle").textContent=q?"Search results":"Discover music";
  $("#listTitle").textContent=q?`Results for “${q}”`:"Trending on Audius";
  $("#listEyebrow").textContent=q?"SEARCH":"FIND YOUR NEXT SOUND";
  try {
    const data=await api(q?"audius-search?q="+encodeURIComponent(q):"audius-search?mode=trending");
    S.results=data.tracks||[];
  } catch(e) { S.results=[]; toast(e.message); }
  render();
}
function switchView(view) {
  S.view=view;
  const titles={discover:"Discover music",library:"My music",favs:"Favourites",history:"Listening history"};
  $("#pageTitle").textContent=titles[view]||"Discover music";
  $("#listTitle").textContent={discover:"Trending on Audius",library:"Your music library",favs:"Your favourites",history:"Recently played"}[view];
  $("#listEyebrow").textContent={discover:"FIND YOUR NEXT SOUND",library:"GITHUB MUSIC FOLDER",favs:"YOUR COLLECTION",history:"YOUR LISTENING"}[view];
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  if(view==="discover" && !S.results.length) { searchAudius(); return; }
  render();
}

// ---------- Render ----------
function trackRow(t,i,where) {
  const fav=S.favs.some(x=>x.id===t.id), current=cur()?.id===t.id;
  const allHooks=hooksOf(t);
  const hooks=settings.profileHookDisplay==="all" ? allHooks : allHooks.filter(h=>h.source!=="auto");
  const hookMenu=hooks.length
    ? hooks.map((h,n)=>`<button type="button" class="hook-pick-option" data-select-next-hook="${esc(t.id)}" data-hook-id="${esc(h.id)}"><span class="hook-pick-number">${n+1}</span><span><b>${esc(h.lyric||"Hook "+(n+1))}</b><small>Starts at ${fmtHook(h.t)}${h.end!=null?" · ends "+fmt(h.end):""}</small></span></button>`).join("")
    : '<div class="hook-pick-empty">No saved hooks for this song yet.</div>';
  const buttons=where==="queue"
    ? `<button data-queue-play-next="${i}" class="queue-play-next">Play next</button><button data-remove="${i}">Remove</button>`
    : `<button data-play="${esc(t.id)}">Play</button><button data-play-next="${esc(t.id)}">Play next</button><button data-add="${esc(t.id)}">Queue</button>`;
  return `<div class="track-row ${current?"current":""}" data-track-id="${esc(t.id)}" ${where==="queue"?`draggable="true" data-queue-index="${i}"`:""}>
    <div class="track-hook-wrap">
      <button type="button" class="track-hook-count" aria-label="${hooks.length} saved hooks" >${hooks.length}</button>
      <div class="track-hook-popover"><div class="hook-popover-title">PLAY NEXT FROM HOOK</div>${hookMenu}</div>
    </div>
    <div class="track-meta"><b title="${esc(t.title)}">${esc(displaySongTitle(t.title))}</b><small>${esc(t.artist||"Unknown")} · ${t.provider==="mine"?"My music":"Audius"}${where==="queue"&&i===S.idx?" · PLAYING":""}</small></div>
    <div class="track-actions">${buttons}<button class="star" data-fav="${esc(t.id)}">${fav?"★":"☆"}</button></div>
  </div>`;
}
function renderRecommendations() {
  const panel=$("#aiPanel");
  if(!settings.aiEnabled) { panel.style.display="none"; return; }
  panel.style.display="";
  $("#recs").innerHTML=S.recs.length ? S.recs.map((t,i)=>trackRow(t,i,"recs")).join("") : '<div class="empty-state">Play a track to receive AI recommendations.</div>';
  bindTrackActions();
}
function visibleTracks() {
  if(S.view==="library") return S.lib.map(toTrack);
  if(S.view==="favs") return S.favs;
  if(S.view==="history") return S.hist;
  return S.results;
}
// Lyrics intelligence bridge: expose read-only queue snapshots and a safe hook update method.
window.VibeFlowDJ = {
  getTracks() {
    const current=cur();
    const nextTrack=S.queue[S.idx+1] || null;
    return {
      current: current ? {...current,hooks:hooksOf(current),mixAnalysis:current.mixAnalysis||null,vocalMap:current.vocalMap||null} : null,
      next: nextTrack ? {...nextTrack,hooks:hooksOf(nextTrack),mixAnalysis:nextTrack.mixAnalysis||null,vocalMap:nextTrack.vocalMap||null} : null,
      queue: S.queue.map((track,index)=>({...track,hooks:hooksOf(track),mixAnalysis:track.mixAnalysis||null,vocalMap:track.vocalMap||null,queueIndex:index,isCurrent:index===S.idx}))
    };
  },
  async analyseAudio(trackId) {
    const track=S.queue.find(item=>item.id===trackId) || [...S.lib.map(toTrack),...S.results,...S.recs,...S.favs].find(item=>item.id===trackId);
    if(!track) throw new Error("Track is no longer in the queue.");
    const url=await getUrl(track);
    const analysis=await window.VibeHookScanner.analyseDetailed(url);
    track.mixAnalysis=analysis;
    S.bpmCache[track.id]={bpm:analysis.bpm,confidence:analysis.bpmConfidence,at:Date.now(),source:"audio-structure"};
    store.set("bpmCache",S.bpmCache);
    const cues=(analysis.energyHooks||[]).map((candidate,index)=>({
      id:"audio-"+Math.round(candidate.t*10)+"-"+index,
      t:Math.round(candidate.t*2)/2,
      end:candidate.end!=null?Math.round(candidate.end*2)/2:null,
      endSource:"auto",lyric:candidate.label||"Audio energy section",
      source:"auto",detector:candidate.type||"energy-peak",
      confidence:candidate.confidence,generatedAt:Date.now()
    }));
    track.hooks=mergeHookLists(hooksOf(track),cues);
    syncTrackHooks(track.id,track.hooks);
    if(track.provider==="mine") {
      const entry=getLibTrack(track.id);
      if(entry){entry.mixAnalysis=analysis;entry.hooks=track.hooks;saveLib();}
    }
    save();
    // Do not rerender the whole player or emit queue-updated from background analysis.
    // That event can recursively schedule more analysis while a transition is pending.
    renderHooks();
    return {analysis,generatedHooks:cues.length};
  },
  applyVocalMap(trackId, lines, duration) {
    const track=S.queue.find(item=>item.id===trackId);
    if(!track || !window.VibeVocalIntelligence) return null;
    const map=window.VibeVocalIntelligence.buildMap(lines,duration||track.duration||0);
    track.vocalMap=map;
    if(track.provider==="mine") {
      const entry=getLibTrack(track.id);
      if(entry){entry.vocalMap=map;saveLib();}
    }
    save();
    return map;
  },
  planVocalSafeMix(outgoingId,incomingId,outgoingAt,crossfadeSeconds) {
    const outgoing=S.queue.find(item=>item.id===outgoingId);
    const incoming=S.queue.find(item=>item.id===incomingId);
    if(!window.VibeVocalIntelligence) return {safe:false,reason:"Vocal intelligence module is unavailable."};
    return window.VibeVocalIntelligence.planCandidate(
      outgoing?.vocalMap,incoming?.vocalMap,Number(outgoingAt)||0,Number(crossfadeSeconds)||6
    );
  },
  applyLyricsHooks(trackId, generatedHooks) {
    const track=S.queue.find(item=>item.id===trackId);
    if(!track || !Array.isArray(generatedHooks)) return false;
    const existing=hooksOf(track);
    const merged=[...existing];
    for(const hook of generatedHooks) {
      const duplicate=merged.some(item=>Math.abs(Number(item.t)-Number(hook.t))<5);
      if(!duplicate) merged.push(hook);
    }
    track.hooks=merged.sort((a,b)=>Number(a.t)-Number(b.t));
    syncTrackHooks(trackId,track.hooks);
    if(track.provider==="mine") {
      const entry=getLibTrack(trackId);
      if(entry){entry.hooks=track.hooks;saveLib();}
    }
    save();
    renderHooks();
    return true;
  }
};
function render() {
  const t=cur();
  renderPunchDeck();
  $("#title").textContent=t?displaySongTitle(t.title):"Nothing playing yet";
  $("#artist").textContent=t?.artist||"Choose a track from Discover or My music";
  const art=$("#art"), cover=art.closest(".cover-wrap"), vinyl=$("#vinylFallback");
  cover.classList.toggle("no-art",!t?.art);
  vinyl.classList.toggle("paused",audio().paused);
  art.onerror=()=>cover.classList.add("no-art");
  art.onload=()=>cover.classList.remove("no-art");
  art.src=t?.art||"";
  $("#miniTitle").textContent=t?displaySongTitle(t.title):"Nothing playing";
  $("#miniArtist").textContent=t?.artist||"VibeFlow";
  if($("#partySong")) $("#partySong").textContent=t?displaySongTitle(t.title):"Nothing playing yet";
  if($("#partyArtist")) $("#partyArtist").textContent=t?.artist||"Choose your first track";
  if($("#partyPlay")) $("#partyPlay").textContent=audio().paused?"▶":"Ⅱ";
  $("#playState").textContent=audio().paused?"· PAUSED":"· PLAYING";
  $("#pp").textContent=audio().paused?"▶":"Ⅱ";
  $("#barPlay").textContent=audio().paused?"▶":"Ⅱ";
  $("#hookStatus").textContent=S.activeHook?`${S.activeHook.lyric||"Hook"} · ${fmt(S.activeHook.t)}`:"No hook selected";
  if($("#partySong")) $("#partySong").textContent=t?.title||"Nothing playing yet";
  if($("#partyArtist")) $("#partyArtist").textContent=t?.artist||"Choose your first track";
  if($("#partyPlay")) $("#partyPlay").textContent=audio().paused?"▶":"Ⅱ";
  
  $("#shuffle").classList.toggle("active",S.shuffle);
  $("#repeat").classList.toggle("active",S.repeat);
  $("#queueCount").textContent=S.queue.length;
  const tracks=visibleTracks();
  $("#list").innerHTML=tracks.length?tracks.map((x,i)=>trackRow(x,i,"list")).join(""):'<div class="empty-state">Nothing here yet. Add songs to your GitHub songs folder or search Audius.</div>';
  const queuedNext=S.queue[S.idx+1] || null;
  const nextLabel=queuedNext
    ? `<div class="queue-next-preview"><span class="live-dot"></span><div><small>COMING UP NEXT</small><b title="${esc(queuedNext.title)}">${esc(displaySongTitle(queuedNext.title))}</b><span>${esc(queuedNext.artist||"Unknown")}</span></div></div>`
    : `<div class="queue-next-preview queue-next-random"><span class="live-dot"></span><div><small>COMING UP NEXT</small><b>Auto shuffle</b><span>Another track will be selected automatically</span></div></div>`;
  $("#queue").innerHTML=nextLabel+(S.queue.length?S.queue.map((x,i)=>trackRow(x,i,"queue")).join(""):'<div class="empty-state">Queue is empty. Add a track to get started.</div>');
  updateUpcomingCard(queuedNext);
  renderHooks();
  $("#waveform").classList.toggle("paused",audio().paused);
  if(!$("#waveform").children.length) $("#waveform").innerHTML=Array.from({length:36},(_,i)=>`<i style="height:${8+((i*17)%34)}px;animation-delay:${-(i%9)*.13}s"></i>`).join("");
  syncControls();
  bindTrackActions();
  updateDJStatus();
  window.dispatchEvent(new CustomEvent("vibeflow:queue-updated"));
}
function animateNextShadow(sourceRow) {
  const source=sourceRow?.getBoundingClientRect();
  const target=document.querySelector(".now-card .cover-wrap");
  if(!source || !target) return;
  const targetRect=target.getBoundingClientRect();
  const ghost=sourceRow.cloneNode(true);
  ghost.querySelectorAll(".track-actions,.track-hook-popover,button").forEach(el=>el.remove());
  ghost.removeAttribute("draggable");
  ghost.setAttribute("aria-hidden","true");
  ghost.classList.remove("current","dragging","drop-target","track-entering","track-arrived");
  ghost.classList.add("queue-shadow-flight");
  ghost.style.left=source.left+"px"; ghost.style.top=source.top+"px";
  ghost.style.width=source.width+"px"; ghost.style.height=source.height+"px";
  document.body.appendChild(ghost);
  const dx=(targetRect.left+targetRect.width/2)-(source.left+source.width/2);
  const dy=(targetRect.top+targetRect.height/2)-(source.top+source.height/2);
  const animation=ghost.animate([
    {transform:"translate(0,0) scale(1)",opacity:.92,filter:"drop-shadow(0 0 0 #b987ff)"},
    {transform:"translate("+dx*.58+"px,"+dy*.58+"px) scale(.72)",opacity:.86,filter:"drop-shadow(0 0 18px #c48aff)"},
    {transform:"translate("+dx+"px,"+dy+"px) scale(.12)",opacity:0,filter:"drop-shadow(0 0 25px #e3c4ff)"}
  ],{duration:760,easing:"cubic-bezier(.18,.78,.22,1)"});
  animation.onfinish=()=>ghost.remove();
  animation.oncancel=()=>ghost.remove();
}
function scheduleTrackDisplayUpdate(token) {
  clearTimeout(S.displayUpdateTimer);
  const delay=[0,1,2,3,4,5].includes(+settings.displayUpdateDelay)?+settings.displayUpdateDelay:0;
  S.displayUpdateTimer=setTimeout(()=>{
    if(token!==S.tok) return;
    render();
    renderHooks();
    document.querySelector(".queue-list .track-row.current")?.classList.add("track-arrived");
  },delay*1000);
}
function updateUpcomingCard(track) {
  const card=$("#djUpcoming");
  if(!card) return;
  const title=$("#djUpcomingTitle"), sub=$("#djUpcomingSub");
  if(!track) {
    title.textContent="Auto shuffle";
    sub.textContent="Next track will be selected automatically";
    card.classList.remove("has-track");
  } else {
    const changed=card.dataset.trackId!==track.id;
    card.dataset.trackId=track.id;
    title.textContent=displaySongTitle(track.title);
    sub.textContent=(track.artist||"Unknown")+" · "+(hooksOf(track).length?hooksOf(track).length+" hooks ready":"no saved hook");
    card.classList.add("has-track");
    if(changed) {card.classList.remove("upcoming-blink");void card.offsetWidth;card.classList.add("upcoming-blink");}
  }
}
function bindTrackActions() {
  document.querySelectorAll("[data-select-next-hook]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.selectNextHook, hookId=b.dataset.hookId;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    const hook=track && hooksOf(track).find(h=>String(h.id)===String(hookId));
    if(!track || !hook) return;
    if(track.id===cur()?.id) return toast("Choose a hook from a different song.");
    addQueue(track,"next");
    const queued=S.queue.find(x=>x.id===track.id);
    if(queued) queued._chosenHook={id:hook.id,t:hook.t,end:hook.end??null,lyric:hook.lyric||"Hook"};
    save(); render();
    toast(`${track.title} is next from ${hook.lyric||"Hook"} after the current cue finishes.`);
  });
  document.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.play;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(track) playTrack(track);
  });
  document.querySelectorAll("[data-play-next]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.playNext;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(track){animateNextShadow(b.closest(".track-row"));addQueue(track,"next");toast(`${track.title} will play next.`);}
  });
  document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.add;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(track){addQueue(track);toast("Added to queue.");}
  });
  document.querySelectorAll("[data-fav]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.fav;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(!track)return;
    S.favs=S.favs.some(x=>x.id===id)?S.favs.filter(x=>x.id!==id):[track,...S.favs];
    save();render();
  });
  document.querySelectorAll("[data-queue-play-next]").forEach(b=>b.onclick=()=>{
    const index=+b.dataset.queuePlayNext;
    const chosen=S.queue[index];
    if(!chosen || index===S.idx) return;
    const [item]=S.queue.splice(index,1);
    if(index<S.idx) S.idx--;
    S.queue.splice(Math.max(0,S.idx+1),0,item);
    save(); render(); toast(`${chosen.title} will play next.`);
  });
  document.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>removeQueue(+b.dataset.remove));
  document.querySelectorAll("[data-queue-index]").forEach(el=>{
    el.addEventListener("dragstart",e=>{S.dragIndex=+el.dataset.queueIndex;el.classList.add("dragging");e.dataTransfer.effectAllowed="move";});
    el.addEventListener("dragend",()=>{S.dragIndex=null;el.classList.remove("dragging");document.querySelectorAll(".drop-target").forEach(x=>x.classList.remove("drop-target"));});
    el.addEventListener("dragover",e=>{e.preventDefault();el.classList.add("drop-target");});
    el.addEventListener("dragleave",()=>el.classList.remove("drop-target"));
    el.addEventListener("drop",e=>{e.preventDefault();el.classList.remove("drop-target");reorderQueue(S.dragIndex,+el.dataset.queueIndex);});
  });
}

// ---------- Player events ----------
$("#addHook").onclick=addHook;
$("#markPunchStart").onclick=savePunchStart; $("#markPunchEnd").onclick=savePunchEnd; $("#savePunch").onclick=savePunch;
$("#punchMenuButton").onclick=openPunchManager;
$("#scanHooks").onclick=()=>scanCurrentSongHooks();
$("#mix").onclick=mixNext;
$("#forceMix").onclick=forceMixNow;
$("#prev").onclick=previous; $("#barPrev").onclick=previous;
$("#next").onclick=next; $("#barNext").onclick=next;
$("#pp").onclick=togglePlay; $("#barPlay").onclick=togglePlay;
function togglePlay(smash=false) {
  if(smash) {
    document.body.classList.remove("spacebar-smash");
    void document.body.offsetWidth;
    document.body.classList.add("spacebar-smash");
    clearTimeout(togglePlay.smashTimer);
    togglePlay.smashTimer=setTimeout(()=>document.body.classList.remove("spacebar-smash"),460);
  }
  const a=audio();
  if(a.paused) {
    if(!a.src && cur()) playTrack(cur());
    else a.play().then(()=>{a.volume=vol();render();}).catch(()=>toast("Press play to start audio."));
  } else a.pause();
}
$("#shuffle").onclick=()=>{S.shuffle=!S.shuffle;$("#shuffle").classList.toggle("active",S.shuffle);};
$("#repeat").onclick=()=>{S.repeat=!S.repeat;$("#repeat").classList.toggle("active",S.repeat);};
$("#vol").oninput=()=>{if(!S.mixing)audio().volume=vol();};
const seekSlider=$("#seek");
function beginSeek() {
  if(S.seeking) return;
  S.seeking=true;
  S.seekMoved=false;
  S.seekResumeAt=0;
  S.seekResetDelay=seekResetDuration();
  updateDJStatus();
}
function updateSeek(value) {
  const a=audio();
  if(!Number.isFinite(a.duration) || !a.duration) return;
  const target=Math.max(0,Math.min(a.duration,a.duration*(+value/1000)));
  S.seekMoved=true;
  try { a.currentTime=target; } catch(e) { console.warn("Seek unavailable during media transition",e); }
  $("#time").textContent=`${fmt(target)} / ${fmt(a.duration)}`;
  updateDJStatus();
}
function finishSeek() {
  const a=audio(), t=cur();
  if(!S.seeking) return;
  S.seeking=false;
  if(!S.seekMoved) { updateDJStatus(); return; }
  // Every completed manual seek restarts the full cue window from the new position.
  // The countdown begins only after the slider is released; dragging never skips.
  S.seekResetDelay=seekResetDuration();
  S.seekResetMediaTime=a.currentTime;
  S.seekResumeAt=true;
  updateDJStatus();
}
seekSlider.addEventListener("pointerdown",beginSeek);
seekSlider.addEventListener("touchstart",beginSeek,{passive:true});
seekSlider.addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key))beginSeek();});
seekSlider.addEventListener("input",e=>{if(!S.seeking)beginSeek();updateSeek(e.target.value);});
seekSlider.addEventListener("change",finishSeek);
seekSlider.addEventListener("pointerup",finishSeek);
seekSlider.addEventListener("pointercancel",finishSeek);
seekSlider.addEventListener("touchend",finishSeek);
seekSlider.addEventListener("keyup",e=>{if(S.seeking && ["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(e.key))finishSeek();});
window.addEventListener("blur",finishSeek);
$("#mixsec").onchange=e=>{settings.mixLength=e.target.value==="random"?"random":([0,3,6,9].includes(+e.target.value)?+e.target.value:6);saveSettings();updateCrossfadeIndicator();};
$("#autoMode").onchange=e=>{settings.autoMode=e.target.value;saveSettings();};
$("#searchForm").onsubmit=e=>{e.preventDefault();const q=$("#searchInput").value.trim();searchAudius(q);};
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$("#refreshLibrary").onclick=async()=>{await initLib();toast(`Found ${S.lib.length} songs in GitHub.`);};
$("#exportHooks").onclick=exportHooksBackup;
$("#importHooks").onclick=()=>$("#importHooksFile").click();
$("#importHooksFile").onchange=e=>{importHooksBackup(e.target.files?.[0]);e.target.value="";};
$("#lyricsPanelToggle").onclick=()=>{const panel=$("#lyricsStudio");const show=panel.hidden;panel.hidden=!show;$("#lyricsPanelToggle").setAttribute("aria-expanded",String(show));$("#lyricsPanelToggle").classList.toggle("active",show);};
async function pickRandomManualHookTrack() {
  if(!S.lib.length) await initLib();
  const candidates=S.lib.filter(entry=>Array.isArray(entry.hooks)&&entry.hooks.some(h=>h&&h.source!=="auto"&&Number.isFinite(Number(h.t))));
  if(!candidates.length) {
    toast("No manually saved hooks found yet. Save at least one hook in My music first.");
    return false;
  }
  const currentId=cur()?.id;
  const fresh=candidates.filter(entry=>"my:"+entry.file!==currentId);
  const pool=fresh.length?fresh:candidates;
  const entry=pool[Math.floor(Math.random()*pool.length)];
  const track=toTrack(entry);
  const hook=verifiedRandomHook(track);
  if(!hook) return false;
  transitionTo(track,hook,{manual:true,mode:"hook",initialFade:true});
  return true;
}
function enablePartyDJTools() {
  settings.mixLength="random";
  saveSettings();
  syncControls();
  const panel=$("#lyricsStudio"), toggle=$("#lyricsPanelToggle");
  if(panel.hidden) panel.hidden=false;
  toggle.setAttribute("aria-expanded","true");
  toggle.classList.add("active");
  const auto=$("#lyricsAutoMode");
  if(auto && !auto.checked) { auto.checked=true; auto.dispatchEvent(new Event("change",{bubbles:true})); }
  if(!S.autoMix) { S.autoMix=true; store.set("autoMix",true); syncControls(); }
}
async function launchPartyWithManualHook() {
  enablePartyDJTools();
  if(!cur() || audio().paused) await pickRandomManualHookTrack();
  else {
    // Party mode always starts on a saved-hook track, even if another track was already playing.
    await pickRandomManualHookTrack();
  }
}
$("#firstPlayButton").onclick=async()=>{
  const button=$("#firstPlayButton"), prompt=$("#firstPlayPrompt");
  button.disabled=true;
  button.textContent="Finding a saved hook…";
  const started=await pickRandomManualHookTrack();
  if(started) prompt.hidden=true;
  else { button.disabled=false; button.innerHTML='<span aria-hidden="true">▶</span> Start listening'; }
};
$("#partyModeButton").onclick=async()=>{
  await launchPartyWithManualHook();
  $("#partyMode").hidden=false; document.body.classList.add("party-mode-open");
  startPartyBrandLoop(); syncPartyMotion();
  showPartyMessage("Surprise incoming… VIBE FLOW is taking over! 🪩");
  try { if(!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); } catch {}
};
$("#closeParty").onclick=async()=>{
  $("#partyMode").hidden=true; document.body.classList.remove("party-mode-open"); stopPartyBrandLoop();
  try { if(document.fullscreenElement) await document.exitFullscreen?.(); } catch {}
};
$("#partyPlay").onclick=togglePlay;
$("#partyNext").onclick=next;
$("#partyPrev").onclick=previous;
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement && !$("#partyMode").hidden){$("#partyMode").hidden=true;document.body.classList.remove("party-mode-open");stopPartyBrandLoop();}});
$("#openSettings").onclick=openSettings; $("#footerSettings").onclick=openSettings;
function toggleAutoMix() {
  if(S.training.active)return toast("Use Stop training to leave the training session safely.");
  S.autoMix=!S.autoMix;
  store.set("autoMix",S.autoMix);
  syncControls();
  if(S.autoMix) {
    const upcoming=S.queue[S.idx+1];
    if(upcoming && settings.autoMode==="hook") maybeAutoScanUpcoming(upcoming);
    if(cur() && !upcoming) ensureAutoMixNextTrack();
    toast("Auto mix enabled. "+(settings.autoMode==="hook"?"Next track will start from a saved or generated hook.":"Next track will start at your configured no-hook start position."));
  } else {
    toast("Auto mix disabled. The current song will play to its end and then pause.");
  }
}
$("#autoMixToggle").onclick=toggleAutoMix;$("#startTraining").onclick=startTraining;$("#stopTraining").onclick=stopTraining;trainingRefreshStats();trainingSetUi(false);

A.forEach(a=>{
  a.volume=1;
  a.onplay=()=>{if(a===audio()){render();syncPartyMotion();}}; a.onpause=()=>{if(a===audio()){render();syncPartyMotion();}};
  a.ontimeupdate=()=>{
    if(a!==audio())return;
    if(a.duration){if(!S.seeking) $("#seek").value=a.currentTime/a.duration*1000;$("#time").textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;}
    if(!S.seeking) checkHookTimer();
    updateDJStatus();
  };
  a.onended=()=>{if(a===audio()&&!S.transitioning){if(automaticSwitchingEnabled())nextAutomatic();else{a.pause();setDJActivity("TRACK FINISHED · AUTO MIX OFF","The song has ended. Turn Auto mix on or press play to continue.","PAUSED","paused");render();}}};
  a.onerror=()=>{if(a===audio()&&a.src)toast("This audio file could not be played. Check the file URL and format.");};
});
$("#modalRoot").addEventListener("click",e=>{if(e.target.classList.contains("modal-backdrop")&&e.target.dataset.dismiss)$("#modalRoot").innerHTML="";});
window.addEventListener("keydown",e=>{
  if(e.key==="Escape") { $("#modalRoot").innerHTML=""; return; }

  // Never hijack shortcuts while the user is typing or operating a form/control.
  const target=e.target;
  const interactive=target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"],[role="slider"]');
  if(interactive || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.repeat) return;

  const key=e.key.toLowerCase();
  if(e.code==="Space") {
    e.preventDefault();
    togglePlay(true);
    return;
  }

  // Transport and seek
  if(key==="arrowleft" || key==="arrowright") {
    const a=audio();
    if(!Number.isFinite(a.duration) || !a.duration) return;
    e.preventDefault();
    a.currentTime=Math.max(0,Math.min(a.duration,a.currentTime+(key==="arrowright"?5:-5)));
    if(!S.seeking) {
      $("#seek").value=a.currentTime/a.duration*1000;
      $("#time").textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;
    }
    updateDJStatus();
    return;
  }
  if(key==="n") {
    e.preventDefault();
    next();
    return;
  }
  if(key==="p") { e.preventDefault(); previous(); return; }

  // Mixer controls
  if(key==="arrowup" || key==="arrowdown") {
    e.preventDefault();
    const slider=$("#vol");
    slider.value=String(Math.max(0,Math.min(100,+slider.value+(key==="arrowup"?5:-5))));
    if(!S.mixing) audio().volume=vol();
    toast(`Volume ${slider.value}%`);
    return;
  }
  if(key==="m") {
    audio().muted=!audio().muted;
    toast(audio().muted?"Muted":"Unmuted");
    return;
  }
  if(key==="a") { toggleAIDJ(); return; }
  if(key==="s") {
    S.shuffle=!S.shuffle;
    $("#shuffle").classList.toggle("active",S.shuffle);
    toast(`Shuffle ${S.shuffle?"on":"off"}`);
    return;
  }
  if(key==="r") {
    S.repeat=!S.repeat;
    $("#repeat").classList.toggle("active",S.repeat);
    toast(`Repeat ${S.repeat?"on":"off"}`);
    return;
  }
  if(key==="?") {
    toast("VIBE FLOW SHORTCUTS · Space Play/Pause · ←/→ Seek 5s · ↑/↓ Volume · N Next · P Previous · S Shuffle · R Repeat · M Mute");
  }
});

// ---------- Start ----------
(async()=>{
  syncControls();
  await initLib();
  switchView("library");
  if(cur()) render();
})();
