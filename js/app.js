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
  mixLength: 6, leadSubtract: 2, hookPlaySeconds: 24, noHookSeconds: 45, noHookStartSeconds: 20,
  displayUpdateDelay: 0, aiEnabled: true, autoMode: "random", autoAdvance: true
};
const settings = { ...defaults, ...store.get("settings", {}) };
const S = {
  queue: store.get("queue", []), idx: store.get("idx", -1),
  favs: store.get("favs", []), hist: store.get("hist", []),
  patterns: store.get("patterns", []), hookPlays: store.get("hookPlays", {}),
  trackPlays: store.get("trackPlays", {}), radio: false, shuffle: false,
  repeat: false, view: "discover", results: [], recs: [], busy: false,
  tok: 0, mixing: false, transitioning: false, activeHook: null,
  transitionTimer: null, env: {}, lib: [], dragIndex: null,
  seeking: false, seekResetMediaTime: null, seekResetDelay: 0, seekResumeAt: 0,
  activeNoHookDeadline: null, displayUpdateTimer: null,
  hookScans: store.get("hookScans", {}), autoHookInFlight: new Set(), autoHookStartedAt: {},
  aiHookTrackId: null, aiHookScanning: false
};
const save = () => {
  for (const [k, v] of Object.entries({
    queue:S.queue, idx:S.idx, favs:S.favs, hist:S.hist,
    patterns:S.patterns, hookPlays:S.hookPlays, trackPlays:S.trackPlays, hookScans:S.hookScans
  })) store.set(k, v);
};
const saveSettings = () => store.set("settings", settings);
const toast = msg => {
  const el = $("#toast"); el.textContent = msg; el.style.display = "block";
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = "none", 3800);
};
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => Number.isFinite(+n) ? `${Math.floor(+n/60)}:${String(Math.floor(+n%60)).padStart(2,"0")}` : "0:00";
const fmtHook = n => `${fmt(n)}${Math.abs((+n)-Math.round(+n))>.01?".5":""}`;
const cur = () => S.queue[S.idx] || null;
const mixSec = () => +settings.mixLength;
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
    const localMap = new Map((Array.isArray(local)?local:[]).filter(x=>x?.file).map(x=>[x.file,x]));
    const merged = new Map();
    for (const song of discovered) {
      const old = localMap.get(song.file) || {};
      merged.set(song.file, {...song,...old,hooks:old.hooks || song.hooks});
    }
    S.lib = [...merged.values()];
    $("#libraryStatus").textContent = `${S.lib.length} songs discovered`;
    saveLib();
  } catch (e) {
    console.error("GitHub discovery:", e);
    S.lib = Array.isArray(local) ? local : [];
    $("#libraryStatus").textContent = "GitHub library unavailable";
    toast(`GitHub library error: ${e.message}`);
  }
  render();
}
const saveLib = () => store.set("lib", S.lib);
const getLibTrack = id => S.lib.find(f => "my:"+f.file === id);
const hooksOf = t => Array.isArray(t?.hooks) ? t.hooks : [];

// ---------- Settings ----------
function openSettings() {
  const root = $("#modalRoot");
  root.innerHTML = `
  <div class="modal-backdrop" data-close="1"><div class="modal-card" role="dialog" aria-modal="true">
    <div class="modal-head"><div><div class="eyebrow">PERSONALISE YOUR DJ</div><h2>VibeFlow settings</h2><p class="modal-sub">Control how tracks are selected, mixed and repeated.</p></div><button class="modal-close" data-close="1">×</button></div>
    <div class="toggle-row"><div><b>AI recommendations</b><small>Turn off AI requests, suggestions and AI Radio completely.</small></div><input class="switch" id="setAI" type="checkbox" ${settings.aiEnabled?"checked":""}></div>
    <div class="toggle-row"><div><b>Automatic track switching</b><small>Keep the music moving without manually pressing next.</small></div><input class="switch" id="setAuto" type="checkbox" ${settings.autoAdvance?"checked":""}></div>
    <div class="settings-grid" style="margin-top:14px">
      <div class="setting-field"><label for="setMix">Crossfade length</label><select id="setMix"><option value="0">Off (no crossfade)</option><option value="3">3 seconds</option><option value="6">6 seconds</option><option value="9">9 seconds</option></select><small>How long both songs overlap.</small></div>
      <div class="setting-field"><label for="setLead">Seconds to subtract from mix length</label><input id="setLead" type="number" min="0" max="8" step="1" value="${settings.leadSubtract}"><small>Default 2. Hook starts at hook time − (mix length − this value).</small></div>
      <div class="setting-field"><label for="setHookDuration">Play time after hook start</label><input id="setHookDuration" type="number" min="5" max="300" step="1" value="${settings.hookPlaySeconds}"><div class="seconds-stepper" aria-label="Adjust hook seconds"><button type="button" id="hookSecondsDown" title="Decrease by 1 second" aria-label="Decrease hook seconds">▼</button><span>−1 sec</span><button type="button" id="hookSecondsUp" title="Increase by 1 second" aria-label="Increase hook seconds">▲</button></div><small>Used when that hook has no marked end. Use the arrows to adjust by exactly 1 second.</small></div>
      <div class="setting-field"><label for="setNoHook">Fallback time without a hook end</label><input id="setNoHook" type="number" min="5" max="600" step="5" value="${settings.noHookSeconds}"><small>Switch after this many seconds if no hook end is available.</small></div>
      <div class="setting-field"><label for="setNoHookStart">Start position when no hook is saved</label><input id="setNoHookStart" type="number" min="0" max="300" step="1" value="${settings.noHookStartSeconds}"><small>Start unmarked songs at this position. Default: 20 seconds.</small></div>
      <div class="setting-field"><label for="setDisplayDelay">Update current / next song details</label><select id="setDisplayDelay"><option value="0">Immediately (0 seconds)</option><option value="1">After 1 second</option><option value="2">After 2 seconds</option><option value="3">After 3 seconds</option><option value="4">After 4 seconds</option><option value="5">After 5 seconds</option></select><small>Wait this long after the new track starts before refreshing the Now Playing and Coming Up Next details.</small></div>
      <div class="setting-field"><label for="setMode">Automatic mix mode</label><select id="setMode"><option value="random">Random / smart</option><option value="hook">Always choose a saved hook</option><option value="beginning">Start at song beginning</option><option value="off">Off</option></select><small>Controls how automatic transitions choose the next start point.</small></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button data-close="1">Cancel</button><button id="saveSettings" class="primary-btn">Save settings</button></div>
  </div></div>`;
  $("#setMix").value = String(settings.mixLength);
  $("#setMode").value = settings.autoMode;
  $("#setDisplayDelay").value = String([0,1,2,3,4,5].includes(+settings.displayUpdateDelay)?settings.displayUpdateDelay:0);
  const hookSecondsInput=$("#setHookDuration");
  $("#hookSecondsDown").onclick=()=>{hookSecondsInput.value=String(Math.max(5,(+hookSecondsInput.value||settings.hookPlaySeconds)-1));};
  $("#hookSecondsUp").onclick=()=>{hookSecondsInput.value=String(Math.min(300,(+hookSecondsInput.value||settings.hookPlaySeconds)+1));};
  root.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",e=>{
    if (x.classList.contains("modal-backdrop") ? e.target === x : true) root.innerHTML="";
  }));
  $("#saveSettings").onclick = () => {
    settings.aiEnabled = $("#setAI").checked;
    settings.autoAdvance = $("#setAuto").checked;
    settings.mixLength = [0,3,6,9].includes(+$("#setMix").value) ? +$("#setMix").value : 6;
    settings.leadSubtract = Math.max(0,Math.min(8,+$("#setLead").value || 0));
    settings.hookPlaySeconds = Math.max(5,Math.min(300,+$("#setHookDuration").value || 24));
    settings.noHookSeconds = Math.max(5,Math.min(600,+$("#setNoHook").value || 45));
    settings.noHookStartSeconds = Math.max(0,Math.min(300,+$("#setNoHookStart").value || 0));
    settings.displayUpdateDelay = [0,1,2,3,4,5].includes(+$("#setDisplayDelay").value)?+$("#setDisplayDelay").value:0;
    settings.autoMode = $("#setMode").value;
    saveSettings(); root.innerHTML=""; syncControls(); render();
    toast("DJ settings saved.");
  };
}
function syncControls() {
  $("#mixsec").value = String(settings.mixLength);
  $("#autoMode").value = settings.autoMode;
  $("#aiStatus").classList.toggle("off",!S.radio);
  $("#aiStatus").classList.toggle("active",S.radio);
  $("#aiStatus").innerHTML = `<span class="ai-dot"></span> AI DJ ${S.radio?"ON":"OFF"}`;
  $("#aiRadio").textContent = `AI DJ: ${S.radio?"ON":"OFF"}`;
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
  const h={id:crypto.randomUUID?.() || String(Date.now()),t:Math.round(audio().currentTime*2)/2,end:null,lyric:label,endLyric:""};
  entry.hooks=[...hooksOf(entry),h].sort((a,b)=>a.t-b.t);
  t.hooks=entry.hooks; S.activeNoHookDeadline=null; S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:null};
  $("#hookLabel").value=""; saveLib(); save(); renderHooks(); render();
  toast(`Hook marked at ${fmt(h.t)}. Mark its end when the hook finishes.`);
}
function adjustHookStart(id,delta) {
  const t=cur(), entry=t && getLibTrack(t.id);
  if(!entry) return;
  const h=hooksOf(entry).find(x=>String(x.id)===String(id));
  if(!h) return;
  const maxStart=h.end!=null ? Math.max(0,h.end-0.5) : Infinity;
  h.t=Math.max(0,Math.min(maxStart,Math.round((Number(h.t||0)+delta)*2)/2));
  t.hooks=entry.hooks;
  if(S.activeHook?.trackId===t.id && String(S.activeHook.hookId)===String(id)) {
    S.activeHook.t=h.t; S.activeHook.end=h.end ?? null;
  }
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
  h.endLyric=$("#endLine-"+CSS.escape(String(id)))?.value?.trim() || h.endLyric || "";
  t.hooks=entry.hooks; saveLib(); renderHooks();
  toast(`Hook ends at ${fmt(end)}.`);
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
  S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:h.end ?? null};
  markHookPlayed(t,h);
  $("#hookStatus").textContent=`${h.lyric || "Hook"} · ${fmt(h.t)}`;
  toast(`Jumped directly to ${fmt(h.t)}.`);
}
function syncTrackHooks(trackId, hooks) {
  for (const list of [S.queue, S.results, S.recs, S.favs, S.hist]) {
    for (const track of list) if (track?.id === trackId) track.hooks = hooks;
  }
}
async function scanCurrentSongHooks({automatic=false,trackOverride=null}={}) {
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
  if(S.aiHookScanning || (automatic && (S.autoHookInFlight.has(track.id)||S.hookScans[track.id]))) return;
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
    const accepted=candidates.filter(candidate=>!existing.some(h=>
      Math.abs(Number(h.t)-candidate.t)<8 ||
      (String(h.lyric||"").trim().toLowerCase()===candidate.label.toLowerCase())
    )).slice(0,6);
    const generated=accepted.map(candidate=>({
      id:"auto-"+(crypto.randomUUID?.()||String(Date.now()+Math.random())),
      t:Math.round(candidate.t*2)/2,
      end:Math.max(candidate.t+1,Math.round(candidate.end*2)/2),
      lyric:candidate.label,
      endLyric:"",
      source:"auto",
      detector:candidate.type,
      confidence:candidate.confidence,
      generatedAt:Date.now()
    }));
    if(generated.length) {
      entry.hooks=[...existing,...generated].sort((a,b)=>a.t-b.t);
      syncTrackHooks(track.id,entry.hooks);
      saveLib();
    }
    S.hookScans[track.id]={at:Date.now(),generated:generated.length,version:1};
    save();
    if(automatic) {
      setDJActivity(generated.length?"HOOKS AUTO-DETECTED":"SCAN COMPLETE · NO STRONG MATCH",
        generated.length?generated.length+" local cue point(s) ready on "+track.title:"No strong repeated section found on "+track.title,
        "READY","ready");
    } else if(generated.length) {
      toast("Found "+generated.length+" possible hook(s). They are saved as AUTO cues and ready to mix.");
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
  if(!S.radio || !track || track.provider!=="mine" || hooksOf(track).length) return;
  if(S.hookScans[track.id] || S.autoHookInFlight.has(track.id) || S.aiHookScanning) return;
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
    root.innerHTML='<div class="ai-hook-status">◌ AI DJ is scanning the upcoming track: '+esc(song?.title||"next song")+'. Generated cues will be saved automatically.</div>';
    return;
  }
  const track=cur(), scan=track&&S.hookScans[track.id];
  if(scan) {
    root.innerHTML='<div class="ai-hook-status">'+(scan.generated
      ? scan.generated+" AUTO hook(s) detected in the last local scan. They are ready for mixing and can be deleted individually."
      : "Last local scan found no strong repeated or high-energy sections. Your manually saved hooks remain unchanged.")+'</div>';
    return;
  }
  root.innerHTML='<div class="ai-hook-status">Click Analyse for hooks to scan this song locally. AI DJ can also scan an unmarked upcoming song automatically. No API key or audio upload required.</div>';
}
function renderHooks() {
  const t=cur(), hooks=hooksOf(t);
  $("#hookCount").textContent=`${hooks.length} saved · ${hooks.filter(h=>h.source==='auto').length} auto`;
  if(!t || t.provider!=="mine") {
    $("#hooksList").innerHTML='<div class="empty-state">Hooks can be marked on songs in My music.</div>';
    return;
  }
  if(!hooks.length) {
    $("#hooksList").innerHTML='<div class="empty-state">No hooks yet. Play the song and press “Mark hook here”.</div>';
    return;
  }
  $("#hooksList").innerHTML=hooks.map((h,i)=>`
    <div class="hook-item ${h.source==="auto"?"auto-hook-item":"manual-hook-item"}">
      <div class="hook-main">
        <div class="hook-time-control" aria-label="Adjust hook start time">
          <button type="button" data-hook-start-adjust="${esc(h.id)}" data-delta="-0.5" aria-label="Move hook start back half a second" title="−0.5 seconds">−</button>
          <span class="hook-time">${fmtHook(h.t)}</span>
          <button type="button" data-hook-start-adjust="${esc(h.id)}" data-delta="0.5" aria-label="Move hook start forward half a second" title="+0.5 seconds">+</button>
        </div>
        <div class="hook-detail">
          <b title="${esc(h.lyric || "Hook "+(i+1))}">${esc(h.lyric || "Hook "+(i+1))}</b>
          <small><span class="hook-origin ${h.source==="auto"?"auto":"manual"}">${h.source==="auto"?"AUTO":"MANUAL"}</span> · ${h.source==="auto"?(h.detector==="repeated-section"?"Pattern match":"Energy peak"):"User cue"} · ${h.end!=null?`Ends ${fmt(h.end)}${h.endLyric?" · "+esc(h.endLyric):""}`:"End not marked"}</small>
        </div>
      </div>
      <div class="hook-controls">
        <button data-hook-go="${esc(h.id)}" title="Jump exactly to hook">Go</button>
        <input id="endLine-${esc(h.id)}" aria-label="Hook ending lyric" placeholder="End line" value="${esc(h.endLyric||"")}" style="width:110px;padding:6px;font-size:10px">
        <button data-hook-end="${esc(h.id)}" title="Mark hook end here">Mark end</button>
        <button data-hook-delete="${esc(h.id)}" title="Delete hook">×</button>
      </div>
    </div>`).join("");
  $("#hooksList").querySelectorAll("[data-hook-go]").forEach(b=>b.onclick=()=>playHookDirect(hooks.find(h=>String(h.id)===b.dataset.hookGo)));
  $("#hooksList").querySelectorAll("[data-hook-start-adjust]").forEach(b=>b.onclick=()=>adjustHookStart(b.dataset.hookStartAdjust,Number(b.dataset.delta)));
  $("#hooksList").querySelectorAll("[data-hook-end]").forEach(b=>b.onclick=()=>markHookEnd(b.dataset.hookEnd));
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
function fairHook(track) {
  const hooks=hooksOf(track); if(!hooks.length) return null;
  const counts=hooks.map(h=>S.hookPlays[hookKey(track,h)]||0);
  const min=Math.min(...counts);
  const pool=hooks.filter(h=>(S.hookPlays[hookKey(track,h)]||0)===min);
  return pool[Math.floor(Math.random()*pool.length)];
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
  const lead=Math.max(0,mixSec()-settings.leadSubtract);
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

// ---------- Transition animation + two-deck playback ----------
function setDJActivity(title,detail,countdown="--:--",state="ready") {
  const titleEl=$("#djActivity"), detailEl=$("#djDetail"), countEl=$("#djCountdown");
  if(titleEl) titleEl.textContent=title;
  if(detailEl) detailEl.textContent=detail;
  if(countEl) countEl.textContent=countdown;
  const panel=$(".wave-panel");
  if(panel) panel.dataset.djState=state;
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
  const deadline=hook?(hook.end!=null?hook.end:hook.t+settings.hookPlaySeconds):(S.activeNoHookDeadline?.trackId===t.id?S.activeNoHookDeadline.at:settings.noHookSeconds);
  const resetCountdown=S.seeking
    ? S.seekResetDelay
    : (S.seekResumeAt ? S.seekResetDelay-(a.currentTime-S.seekResetMediaTime) : null);
  const left=Math.max(0,resetCountdown==null?deadline-a.currentTime:resetCountdown);
  const clock=String(Math.floor(left/60)).padStart(2,"0")+":"+String(Math.floor(left%60)).padStart(2,"0");
  const nextName=upcoming?.title||"next random pick";
  if(chosen) {
    if(left<=8) setDJActivity("BEAT SYNC · HOOK LOCKED","Lining up “"+(chosen.lyric||"your selected hook")+"” on "+nextName+". Get ready!",clock,"sync");
    else setDJActivity("HOOK LOCKED · READY","Next: "+nextName+" · “"+(chosen.lyric||"selected hook")+"” at "+fmt(chosen.t),clock,"ready");
  } else if(upcoming && hooksOf(upcoming).length) {
    if(left<=8) setDJActivity("SYNCING THE BEAT","Scanning "+hooksOf(upcoming).length+" saved hooks for "+nextName+" · transition imminent",clock,"sync");
    else setDJActivity("HOOKS DETECTED",hooksOf(upcoming).length+" saved cue point(s) ready on "+nextName+" · lining up the next mix",clock,"ready");
  } else if(left<=8) {
    setDJActivity("COUNTDOWN · DROP INCOMING","No saved hook on the next track · preparing the "+settings.noHookStartSeconds+"s fallback start",clock,"sync");
  } else {
    setDJActivity("AI DJ SCANNING","Playing "+t.title+" · next transition in "+clock+" · scanning your music library",clock,"ready");
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
  showTransition.timer=setTimeout(()=>{banner.classList.remove("show");$("#engineState").textContent="READY";updateDJStatus();},Math.max(1800,mixSec()*1000+500));
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
async function transitionTo(track,hook,{manual=false,automatic=false,mode=null}={}) {
  if(!track || S.transitioning) return;
  S.transitioning=true;
  clearTimeout(S.transitionTimer);
  const previous=cur(), token=++S.tok;
  const idx=ensureQueued(track);
  S.idx=idx;
  clearTimeout(S.displayUpdateTimer);
  document.querySelector(".queue-list .track-row.current")?.classList.add("track-entering");
  $(".dj-upcoming")?.classList.add("upcoming-mixing");
  const startAt=hook ? mixStartForHook(hook) : ((automatic || mode==="no-hook") ? settings.noHookStartSeconds : 0);
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
    if(mixSec()===0) {
      // Crossfade disabled: switch decks instantly without overlapping audio.
      old.pause(); old.removeAttribute("src"); old.load();
      nextAudio.volume=vol(); S.mixing=false; S.transitioning=false;
      $(".dj-upcoming")?.classList.remove("upcoming-mixing");
    } else {
      S.mixing=true;
      if(wasPlaying) fade(old,0,mixSec()*1000,()=>{old.pause();old.removeAttribute("src");old.load();});
      else old.pause();
      fade(nextAudio,vol(),mixSec()*1000,()=>{S.mixing=false;S.transitioning=false;$(".dj-upcoming")?.classList.remove("upcoming-mixing");});
    }
    S.activeHook=hook?{trackId:track.id,hookId:hook.id,t:hook.t,end:hook.end??null,lyric:hook.lyric||"Hook"}:null;
    S.activeNoHookDeadline=hook?null:{trackId:track.id,at:startAt+settings.noHookSeconds};
    if(hook) markHookPlayed(track,hook);
    if(previous) rememberPattern(previous,track,hook);
    setDJActivity(hook?"YEAHHH · HOOK DROP!":"NEW TRACK · LET’S GO!",hook
      ? "Now riding “"+(hook.lyric||"the hook")+"” · "+track.title
      : "Now playing "+track.title+" · keep the party moving","LIVE","mix");
    S.hist=[track,...S.hist.filter(x=>x.id!==track.id)].slice(0,100);
    save();
    if(S.radio) ensureAINextTrack();
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
function pickRandomDJTrack() {
  const current=cur();
  let pool=S.lib.filter(f=>"my:"+f.file!==current?.id);
  const recent=new Set(S.hist.slice(0,4).map(t=>t.id));
  const fresh=pool.filter(f=>!recent.has("my:"+f.file));
  if(fresh.length) pool=fresh;
  if(!pool.length) return null;
  const least=Math.min(...pool.map(f=>S.trackPlays["my:"+f.file]||0));
  const fair=pool.filter(f=>(S.trackPlays["my:"+f.file]||0)===least);
  return toTrack(fair[Math.floor(Math.random()*fair.length)]);
}
function ensureAINextTrack() {
  if(!S.radio || !cur() || S.queue[S.idx+1]) return;
  const nextTrack=pickRandomDJTrack();
  if(nextTrack) addQueue(nextTrack,"next");
}

function nextAutomatic() {
  // A queued track always has priority over AI/random selection.
  // This keeps the "Coming up next" display and actual playback in sync.
  const queuedNext = S.queue[S.idx + 1] || null;
  if (S.radio && queuedNext && S.autoHookInFlight.has(queuedNext.id) &&
      Date.now() - (S.autoHookStartedAt[queuedNext.id] || Date.now()) < 15000) {
    setDJActivity("WAITING FOR HOOK SCAN","Letting the local scanner finish on "+queuedNext.title+" before the drop","SCAN","sync");
    return;
  }
  if (!queuedNext && (!settings.autoAdvance || settings.autoMode === "off")) return;

  const t = queuedNext || (S.radio ? pickRandomDJTrack() : pickNextTrack());
  if (!t) { toast("Add more tracks to My music for automatic DJ playback."); return; }

  const chosen = queuedNext?._chosenHook || null;
  const hook = chosen
    ? (hooksOf(t).find(h => String(h.id) === String(chosen.id)) || chosen)
    : (settings.autoMode === "beginning" && !S.radio ? null : fairHook(t));

  if (chosen) { delete t._chosenHook; save(); }
  transitionTo(t, hook, {automatic:true, mode:hook ? "hook" : (settings.autoMode === "beginning" ? "beginning" : "no-hook")});
}
function handleAutoAdvance() {
  if (S.transitioning || S.mixing) return;
  const hasQueuedNext = !!S.queue[S.idx + 1];
  if (!hasQueuedNext && (!settings.autoAdvance || settings.autoMode === "off")) return;
  nextAutomatic();
}
function seekResetDuration() {
  const t=cur();
  const h=S.activeHook && S.activeHook.trackId===t?.id ? S.activeHook : null;
  if(h) return h.end!=null ? Math.max(0.5,h.end-h.t) : settings.hookPlaySeconds;
  return settings.noHookSeconds;
}
function checkHookTimer() {
  const t=cur(), a=audio(); if(!t || a.paused || S.transitioning || S.mixing || S.seeking) return;
  if(S.seekResumeAt) {
    if(a.currentTime-S.seekResetMediaTime>=S.seekResetDelay) {
      S.seekResumeAt=0;
      handleAutoAdvance();
    }
    return;
  }
  const h=S.activeHook && S.activeHook.trackId===t.id ? S.activeHook : null;
  if(h) {
    const deadline=h.end!=null ? h.end : h.t+settings.hookPlaySeconds;
    if(a.currentTime>=deadline) handleAutoAdvance();
  } else {
    const fallback=S.activeNoHookDeadline?.trackId===t.id
      ? S.activeNoHookDeadline.at
      : settings.noHookSeconds;
    if(a.currentTime>=fallback) handleAutoAdvance();
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
  render();
}

// ---------- Render ----------
function trackRow(t,i,where) {
  const fav=S.favs.some(x=>x.id===t.id), current=cur()?.id===t.id;
  const hooks=hooksOf(t);
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
    <div class="track-meta"><b>${esc(t.title)}</b><small>${esc(t.artist||"Unknown")} · ${t.provider==="mine"?"My music":"Audius"}${where==="queue"&&i===S.idx?" · PLAYING":""}</small></div>
    <div class="track-actions">${buttons}<button class="star" data-fav="${esc(t.id)}">${fav?"★":"☆"}</button></div>
  </div>`;
}
function renderRecommendations() {
  const panel=$("#aiPanel");
  if(!settings.aiEnabled) { panel.style.display="none"; return; }
  panel.style.display="";
  $("#recs").innerHTML=S.recs.length ? S.recs.map((t,i)=>trackRow(t,i,"recs")).join("") : '<div class="empty-state">Play a track to receive AI DJ suggestions.</div>';
  bindTrackActions();
}
function visibleTracks() {
  if(S.view==="library") return S.lib.map(toTrack);
  if(S.view==="favs") return S.favs;
  if(S.view==="history") return S.hist;
  return S.results;
}
function render() {
  const t=cur();
  $("#title").textContent=t?.title||"Nothing playing yet";
  $("#artist").textContent=t?.artist||"Choose a track from Discover or My music";
  const art=$("#art"), cover=art.closest(".cover-wrap"), vinyl=$("#vinylFallback");
  cover.classList.toggle("no-art",!t?.art);
  vinyl.classList.toggle("paused",audio().paused);
  art.onerror=()=>cover.classList.add("no-art");
  art.onload=()=>cover.classList.remove("no-art");
  art.src=t?.art||"";
  $("#miniTitle").textContent=t?.title||"Nothing playing";
  $("#miniArtist").textContent=t?.artist||"VibeFlow";
  $("#playState").textContent=audio().paused?"· PAUSED":"· PLAYING";
  $("#pp").textContent=audio().paused?"▶":"Ⅱ";
  $("#barPlay").textContent=audio().paused?"▶":"Ⅱ";
  $("#hookStatus").textContent=S.activeHook?`${S.activeHook.lyric||"Hook"} · ${fmt(S.activeHook.t)}`:"No hook selected";
  $("#shuffle").classList.toggle("active",S.shuffle);
  $("#repeat").classList.toggle("active",S.repeat);
  $("#queueCount").textContent=S.queue.length;
  const tracks=visibleTracks();
  $("#list").innerHTML=tracks.length?tracks.map((x,i)=>trackRow(x,i,"list")).join(""):'<div class="empty-state">Nothing here yet. Add songs to your GitHub songs folder or search Audius.</div>';
  const queuedNext=S.queue[S.idx+1] || null;
  const nextLabel=queuedNext
    ? `<div class="queue-next-preview"><span class="live-dot"></span><div><small>COMING UP NEXT</small><b>${esc(queuedNext.title)}</b><span>${esc(queuedNext.artist||"Unknown")}</span></div></div>`
    : `<div class="queue-next-preview queue-next-random"><span class="live-dot"></span><div><small>COMING UP NEXT</small><b>Auto shuffle</b><span>Another track will be selected automatically</span></div></div>`;
  $("#queue").innerHTML=nextLabel+(S.queue.length?S.queue.map((x,i)=>trackRow(x,i,"queue")).join(""):'<div class="empty-state">Queue is empty. Add a track to get started.</div>');
  updateUpcomingCard(queuedNext);
  renderHooks();
  $("#waveform").classList.toggle("paused",audio().paused);
  if(!$("#waveform").children.length) $("#waveform").innerHTML=Array.from({length:36},(_,i)=>`<i style="height:${8+((i*17)%34)}px;animation-delay:${-(i%9)*.13}s"></i>`).join("");
  syncControls();
  bindTrackActions();
  updateDJStatus();
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
    title.textContent=track.title;
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
$("#mixsec").onchange=e=>{settings.mixLength=[0,3,6,9].includes(+e.target.value)?+e.target.value:6;saveSettings();};
$("#autoMode").onchange=e=>{settings.autoMode=e.target.value;saveSettings();};
$("#searchForm").onsubmit=e=>{e.preventDefault();const q=$("#searchInput").value.trim();searchAudius(q);};
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$("#refreshLibrary").onclick=async()=>{await initLib();toast(`Found ${S.lib.length} songs in GitHub.`);};
$("#openSettings").onclick=openSettings; $("#footerSettings").onclick=openSettings;
function toggleAIDJ() {
  S.radio=!S.radio;
  settings.autoAdvance=S.radio;
  if(S.radio) settings.autoMode="random";
  saveSettings();
  syncControls();
  if(S.radio) {
    if(!cur()) nextAutomatic();
    else if(audio().paused) audio().play().then(()=>{audio().volume=vol();render();}).catch(()=>toast("Press play to start the AI DJ."));
    ensureAINextTrack();
    if(settings.aiEnabled) suggest();
    toast("AI DJ is mixing random tracks.");
  } else {
    toast("AI DJ stopped. Current song will continue.");
  }
}
$("#aiStatus").onclick=toggleAIDJ;
$("#aiRadio").onclick=toggleAIDJ;
A.forEach(a=>{
  a.volume=.8;
  a.onplay=()=>{if(a===audio())render();}; a.onpause=()=>{if(a===audio())render();};
  a.ontimeupdate=()=>{
    if(a!==audio())return;
    if(a.duration){if(!S.seeking) $("#seek").value=a.currentTime/a.duration*1000;$("#time").textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;}
    if(!S.seeking) checkHookTimer();
    updateDJStatus();
  };
  a.onended=()=>{if(a===audio()&&!S.transitioning&&(!!S.queue[S.idx+1]||(settings.autoAdvance&&settings.autoMode!=="off")))nextAutomatic();};
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
    if(S.queue[S.idx+1]) nextAutomatic(); else next();
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
    toast("VIBE FLOW SHORTCUTS · Space Play/Pause · ←/→ Seek 5s · ↑/↓ Volume · N Next · P Previous · A AI DJ · S Shuffle · R Repeat · M Mute");
  }
});

// ---------- Start ----------
(async()=>{
  syncControls();
  await initLib();
  await searchAudius();
  if(cur()) render();
})();
