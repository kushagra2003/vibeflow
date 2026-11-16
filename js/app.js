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
  mixLength: 6, leadSubtract: 2, playDurationMode: "full", skipAfterSeconds: 180,
  endAction: "smart", displayUpdateDelay: 0, aiEnabled: true
};
const savedSettings = store.get("settings", {});
const settings = { ...defaults, ...savedSettings };
if (!savedSettings.endAction) settings.endAction = savedSettings.autoAdvance === false || savedSettings.autoMode === "off"
  ? "pause" : savedSettings.autoMode === "beginning" ? "beginning" : "smart";
if (!savedSettings.playDurationMode) settings.playDurationMode = "full";
const S = {
  queue: store.get("queue", []), idx: store.get("idx", -1),
  favs: store.get("favs", []), hist: store.get("hist", []),
  patterns: store.get("patterns", []), hookPlays: store.get("hookPlays", {}),
  trackPlays: store.get("trackPlays", {}), radio: false, shuffle: false,
  repeat: false, view: "discover", results: [], recs: [], busy: false,
  tok: 0, mixing: false, transitioning: false, activeHook: null, autoTransitionPending:false,
  transitionTimer: null, env: {}, lib: [], dragIndex: null,
  seeking: false, seekResetMediaTime: null, seekResetDelay: 0, seekResumeAt: 0,
  activeNoHookDeadline: null, displayUpdateTimer: null,
  hookScans: store.get("hookScans", {}), autoHookInFlight: new Set(), autoHookStartedAt: {},
  aiHookTrackId: null, aiHookScanning: false,
  playWindowRemaining: null, playWindowLastTick: null, preparedNext: null,
  preparingNext: null, preparationToken: 0, endTriggered: false, endWaiting: false
};
const save = () => {
  for (const [k, v] of Object.entries({
    queue:S.queue, idx:S.idx, favs:S.favs, hist:S.hist,
    patterns:S.patterns, hookPlays:S.hookPlays, trackPlays:S.trackPlays, hookScans:S.hookScans
  })) store.set(k, v);
};
const saveSettings = () => store.set("settings", settings);
const automaticSwitchingEnabled = () => settings.endAction !== "pause";
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
    const archivedHooks = store.get("hookArchive", {});
    const merged = new Map();
    for (const song of discovered) {
      const old = localMap.get(song.file) || {};
      merged.set(song.file, {...song,...old,hooks:mergeHookLists(old.hooks, archivedHooks[song.file], song.hooks)});
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
const saveLib = () => {
  store.set("lib", S.lib);
  const archive = Object.fromEntries(S.lib.filter(x=>x?.file).map(x=>[x.file, hooksOf(x)]));
  store.set("hookArchive", archive);
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

// ---------- Settings ----------
function openSettings() {
  const root = $("#modalRoot");
  root.innerHTML = `
  <div class="modal-backdrop" data-close="1"><div class="modal-card" role="dialog" aria-modal="true">
    <div class="modal-head"><div><div class="eyebrow">PERSONALISE YOUR DJ</div><h2>VibeFlow settings</h2><p class="modal-sub">Choose when a song ends and exactly what VIBE FLOW does next.</p></div><button class="modal-close" data-close="1">×</button></div>
    <div class="settings-grid">
      <div class="setting-field"><label for="setDurationMode">How long should each song play?</label><select id="setDurationMode"><option value="full">Play the full song</option><option value="skip">Skip after a set time</option></select><small>Full song lets the track reach its natural ending. Set time starts a fresh countdown whenever a new song begins.</small></div>
      <div class="setting-field" id="skipDurationField"><label for="setSkipSeconds">Play each song for (seconds)</label><input id="setSkipSeconds" type="number" min="15" max="1800" step="15" value="${settings.skipAfterSeconds}"><small>Seeking resets this countdown after you release the progress slider.</small></div>
      <div class="setting-field"><label for="setEndAction">What should happen when the song ends?</label><select id="setEndAction"><option value="pause">Pause – stop playback</option><option value="smart">Smart Mix – random song + hook</option><option value="beginning">Random song – start from beginning</option></select><small>Smart Mix chooses a random song, uses saved hooks or scans locally, then randomly selects a hook. If no hook is detected, the next song starts at 0:00.</small></div>
      <div class="setting-field"><label for="setMix">Crossfade length</label><select id="setMix"><option value="0">Off (instant switch)</option><option value="3">3 seconds</option><option value="6">6 seconds</option><option value="9">9 seconds</option></select><small>How long the outgoing and incoming songs overlap. The incoming hook is aligned to the end of this transition.</small></div>
      <div class="setting-field"><label for="setLead">Hook timing adjustment (seconds)</label><input id="setLead" type="number" min="0" max="8" step="1" value="${settings.leadSubtract}"><small>2 seconds aligns the hook with the end of the crossfade. Increase to bring the hook slightly earlier; decrease to let it land slightly later.</small></div>
      <div class="setting-field"><label for="setDisplayDelay">Update song details</label><select id="setDisplayDelay"><option value="0">Immediately</option><option value="1">After 1 second</option><option value="2">After 2 seconds</option><option value="3">After 3 seconds</option><option value="4">After 4 seconds</option><option value="5">After 5 seconds</option></select><small>Delay the Now Playing and Coming Up Next display after a transition.</small></div>
    </div>
    <div class="toggle-row"><div><b>AI recommendations</b><small>Allow optional AI track suggestions. This does not control automatic playback.</small></div><input class="switch" id="setAI" type="checkbox" ${settings.aiEnabled?"checked":""}></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button data-close="1">Cancel</button><button id="saveSettings" class="primary-btn">Save settings</button></div>
  </div></div>`;
  $("#setDurationMode").value=settings.playDurationMode;
  $("#setEndAction").value=settings.endAction;
  $("#setMix").value=String(settings.mixLength);
  $("#setDisplayDelay").value=String([0,1,2,3,4,5].includes(+settings.displayUpdateDelay)?settings.displayUpdateDelay:0);
  const updateSkipVisibility=()=>{$("#skipDurationField").style.opacity=$("#setDurationMode").value==="skip"?"1":".55";};
  $("#setDurationMode").onchange=updateSkipVisibility; updateSkipVisibility();
  root.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",e=>{
    if(x.classList.contains("modal-backdrop")?e.target===x:true)root.innerHTML="";
  }));
  $("#saveSettings").onclick=()=>{
    settings.aiEnabled=$("#setAI").checked;
    settings.playDurationMode=$("#setDurationMode").value==="skip"?"skip":"full";
    settings.skipAfterSeconds=Math.max(15,Math.min(1800,+$("#setSkipSeconds").value||180));
    settings.endAction=["pause","smart","beginning"].includes($("#setEndAction").value)?$("#setEndAction").value:"smart";
    settings.mixLength=[0,3,6,9].includes(+$("#setMix").value)?+$("#setMix").value:6;
    settings.leadSubtract=Math.max(0,Math.min(8,+$("#setLead").value||0));
    settings.displayUpdateDelay=[0,1,2,3,4,5].includes(+$("#setDisplayDelay").value)?+$("#setDisplayDelay").value:0;
    S.preparedNext=null; S.preparingNext=null; S.preparationToken++; S.endTriggered=false;
    if(settings.playDurationMode==="skip")resetPlaybackWindow();
    saveSettings(); root.innerHTML=""; syncControls(); render();
    toast("Playback settings saved. Your saved hooks are unchanged.");
  };
}
function syncControls() {
  $("#mixsec").value=String(settings.mixLength);
  const smart=settings.endAction==="smart";
  $("#aiStatus").classList.toggle("off",!smart); $("#aiStatus").classList.toggle("active",smart);
  $("#aiStatus").innerHTML=`<span class="ai-dot"></span> SMART MIX ${smart?"ON":"OFF"}`;
  $("#aiStatus").title="Quickly switch between Smart Mix and Pause";
  $("#aiRadio").textContent=`Smart Mix: ${smart?"ON":"OFF"}`;
  if($("#partyAI"))$("#partyAI").textContent=`Smart Mix: ${smart?"ON":"OFF"}`;
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
async function scanCurrentSongHooks({automatic=false,trackOverride=null,force=false}={}) {
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
  if(S.aiHookScanning || (automatic && (S.autoHookInFlight.has(track.id)||(!force&&S.hookScans[track.id])))) return;
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
        ${h.source==="auto"?`<button data-hook-verify="${esc(h.id)}" title="Save and verify this generated hook">Save hook</button>`:""}
        <button data-hook-delete="${esc(h.id)}" title="Delete hook">×</button>
      </div>
    </div>`).join("");
  $("#hooksList").querySelectorAll("[data-hook-go]").forEach(b=>b.onclick=()=>playHookDirect(hooks.find(h=>String(h.id)===b.dataset.hookGo)));
  $("#hooksList").querySelectorAll("[data-hook-start-adjust]").forEach(b=>b.onclick=()=>adjustHookStart(b.dataset.hookStartAdjust,Number(b.dataset.delta)));
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
function fairHook(track) {
  const hooks=hooksOf(track); if(!hooks.length) return null;
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
function mixStartForHook(hook,mixDuration=mixSec()) {
  // 2 seconds is the neutral sync setting: the hook lands as the crossfade ends.
  const fineTune=settings.leadSubtract-2;
  return Math.max(0,hook.t-mixDuration+fineTune);
}

// ---------- Mix choice dialog ----------
function openMixChoices() {
  const from=cur(); if(!from) return toast("Play a track first.");
  const nextTrack=pickNextTrack();
  if(!nextTrack) return toast("Add songs to your library first.");
  const hooks=hooksOf(nextTrack);
  if(!hooks.length) {
    toast(`No saved hooks for ${nextTrack.title}; starting at 0:00.`);
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
  if(S.preparingNext) {
    setDJActivity("FINDING THE NEXT HOOK","Preparing "+S.preparingNext.title+" · checking saved cues or analysing locally","SCAN","sync");
    return;
  }
  if(S.transitioning || S.mixing) {
    setDJActivity("CROSSFADING · LIVE","Blending into the next track. Keep the energy up!","MIXING","mix");
    return;
  }
  if(a.paused) {
    setDJActivity(S.endWaiting?"NEXT TRACK PREPARING":"ENGINE PAUSED",S.endWaiting?"The current song has ended. Waiting for the next cue to finish preparing.":"Playback is paused. Your next action is waiting.","PAUSED","paused");
    return;
  }
  let left=null;
  if(settings.playDurationMode==="skip") left=S.playWindowRemaining??settings.skipAfterSeconds;
  else if(Number.isFinite(a.duration)&&a.duration>0) left=Math.max(0,a.duration-a.currentTime);
  const clock=left==null?"--:--":String(Math.floor(left/60)).padStart(2,"0")+":"+String(Math.floor(left%60)).padStart(2,"0");
  const prepared=S.preparedNext;
  if(settings.endAction==="pause") setDJActivity("PLAYING · PAUSE AT END","The current song will stop. No next song will be selected.",clock,"ready");
  else if(prepared?.hook) setDJActivity("HOOK LOCKED · READY","Next: "+prepared.track.title+" · “"+(prepared.hook.lyric||"selected hook")+"” at "+fmt(prepared.hook.t),clock,"ready");
  else if(prepared) setDJActivity("NEXT TRACK READY","Next: "+prepared.track.title+" · starting at 0:00",clock,"ready");
  else setDJActivity(settings.endAction==="smart"?"SMART MIX · LISTENING":"RANDOM MIX · LISTENING",
    settings.playDurationMode==="full"?"The full song will play. The next track is prepared near the end.":"Next action in "+clock+" · seeking resets the countdown.",clock,"ready");
}
function showTransition(track,hook,automatic=true) {
  const banner=$("#transitionBanner");
  $("#transitionTitle").textContent="DJ ENGINE · PREPARING THE DROP";
  $("#transitionText").textContent=hook
    ? "Hook found: “"+(hook.lyric||"Saved hook")+"” at "+fmt(hook.t)+". Locking the cue and beat…"
    : "No hook detected. "+track.title+" will start from 0:00.";
  $("#transitionCaption").textContent="Next: "+track.title;
  $("#engineState").textContent="SYNCING";
  setDJActivity(hook?"HOOK FOUND · LOCKING CUE":"TRACK FOUND · LOADING",hook
    ? "“"+(hook.lyric||"Saved hook")+"” selected · calculating transition timing"
    : "Preparing "+track.title+" from 0:00 · beat sync in progress","SYNC","sync");
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
async function transitionTo(track,hook,{manual=false,automatic=false,mode=null,mixDuration=null}={}) {
  if(!track || S.transitioning) return;
  S.transitioning=true;
  clearTimeout(S.transitionTimer);
  const previous=cur(), token=++S.tok;
  const fadeSeconds=mixDuration==null?mixSec():Math.max(0,Math.min(mixSec(),mixDuration));
  const idx=ensureQueued(track);
  S.idx=idx;
  clearTimeout(S.displayUpdateTimer);
  document.querySelector(".queue-list .track-row.current")?.classList.add("track-entering");
  $(".dj-upcoming")?.classList.add("upcoming-mixing");
  const startAt=hook ? mixStartForHook(hook,fadeSeconds) : 0;
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
    if(fadeSeconds===0) {
      // Crossfade disabled: switch decks instantly without overlapping audio.
      old.pause(); old.removeAttribute("src"); old.load();
      nextAudio.volume=vol(); S.mixing=false; S.transitioning=false;
      $(".dj-upcoming")?.classList.remove("upcoming-mixing");
    } else {
      S.mixing=true;
      if(wasPlaying) fade(old,0,fadeSeconds*1000,()=>{old.pause();old.removeAttribute("src");old.load();});
      else old.pause();
      fade(nextAudio,vol(),fadeSeconds*1000,()=>{S.mixing=false;S.transitioning=false;$(".dj-upcoming")?.classList.remove("upcoming-mixing");});
    }
    S.activeHook=hook?{trackId:track.id,hookId:hook.id,t:hook.t,end:hook.end??null,lyric:hook.lyric||"Hook"}:null;
    S.activeNoHookDeadline=null;
    S.preparedNext=null; S.preparingNext=null; S.endWaiting=false;
    resetPlaybackWindow();
    if(hook) markHookPlayed(track,hook);
    if(previous) rememberPattern(previous,track,hook);
    setDJActivity(hook?"YEAHHH · HOOK DROP!":"NEW TRACK · LET’S GO!",hook
      ? "Now riding “"+(hook.lyric||"the hook")+"” · "+track.title
      : "Now playing "+track.title+" · keep the party moving","LIVE","mix");
    S.hist=[track,...S.hist.filter(x=>x.id!==track.id)].slice(0,100);
    save();
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

// ---------- Unified playback ending and next-track preparation ----------
function pickRandomDJTrack() {
  const current=cur();
  let pool=S.lib.filter(f=>"my:"+f.file!==current?.id);
  const recent=new Set(S.hist.slice(0,4).map(t=>t.id));
  const fresh=pool.filter(f=>!recent.has("my:"+f.file));
  if(fresh.length)pool=fresh;
  if(!pool.length)return null;
  const least=Math.min(...pool.map(f=>S.trackPlays["my:"+f.file]||0));
  const fair=pool.filter(f=>(S.trackPlays["my:"+f.file]||0)===least);
  return toTrack(fair[Math.floor(Math.random()*fair.length)]);
}
function resetPlaybackWindow() {
  S.playWindowRemaining=settings.skipAfterSeconds;
  S.playWindowLastTick=(!audio().paused&&settings.playDurationMode==="skip"&&!S.seeking)?performance.now():null;
  S.endTriggered=false; S.endWaiting=false;
}
function pausePlaybackWindow() {
  if(S.playWindowLastTick!=null) {
    S.playWindowRemaining=Math.max(0,(S.playWindowRemaining??settings.skipAfterSeconds)-(performance.now()-S.playWindowLastTick)/1000);
    S.playWindowLastTick=null;
  }
}
async function prepareUpcomingTrack() {
  if(settings.endAction==="pause"||S.preparedNext||S.preparingNext||S.transitioning)return;
  const track=pickRandomDJTrack();
  if(!track){setDJActivity("NO NEXT TRACK","Add another song to My music to continue.","READY","ready");return;}
  const token=++S.preparationToken;
  S.preparingNext=track;
  setDJActivity("FINDING THE NEXT HOOK","Random pick: "+track.title+" · checking saved cues","SCAN","sync");
  showPartyMessage("Surprise incoming… finding the next hook! 🎧");
  try {
    if(settings.endAction==="smart"&&track.provider==="mine"&&!hooksOf(track).length) {
      await scanCurrentSongHooks({automatic:true,trackOverride:track,force:true});
      // The scanner persists to the library entry; refresh this temporary track object.
      const refreshed=getLibTrack(track.id);
      if(refreshed) track.hooks=hooksOf(refreshed);
    }
    if(token!==S.preparationToken||settings.endAction==="pause")return;
    const hooks=settings.endAction==="smart"?hooksOf(track):[];
    const hook=hooks.length?hooks[Math.floor(Math.random()*hooks.length)]:null;
    S.preparedNext={track,hook}; S.preparingNext=null;
    setDJActivity(hook?"HOOK LINE FOUND · READY":"NEXT TRACK READY",
      hook?"Random hook selected on "+track.title+" · "+(hook.lyric||fmt(hook.t)):"No hook detected on "+track.title+" · it will start at 0:00",
      "READY","ready");
    showPartyMessage(hook?"Hook line found. Bass drop on the way! 🔊":"No hook found — fresh track incoming from 0:00. ✨");
  } catch(error) {
    if(token===S.preparationToken) {
      S.preparingNext=null; S.preparedNext={track,hook:null};
      setDJActivity("HOOK SCAN UNAVAILABLE","Starting "+track.title+" from 0:00 · "+String(error.message||error).slice(0,90),"READY","ready");
    }
  } finally {
    if(token===S.preparationToken) {
      S.preparingNext=null; render();
      if(S.endWaiting&&S.preparedNext) startPreparedTransition(0);
    }
  }
}
async function startPreparedTransition(remaining=0) {
  if(S.transitioning||S.endTriggered||settings.endAction==="pause")return;
  if(!S.preparedNext) {
    S.endWaiting=true; pausePlaybackWindow();
    if(!S.preparingNext) prepareUpcomingTrack();
    // Preparation's finally block resumes this transition exactly once.
    return;
  }
  const prepared=S.preparedNext;
  if(!prepared)return;
  S.endTriggered=true;
  const fadeSeconds=Math.min(mixSec(),Math.max(0,remaining));
  setDJActivity(prepared.hook?"HOOK LINE FOUND · MIXING NOW":"MIXING · NEW TRACK",
    prepared.hook?"Aligning "+(prepared.hook.lyric||"the selected hook")+" with the end of the crossfade":"No hook detected · starting the random song from 0:00",
    "MIXING","mix");
  showPartyMessage(prepared.hook?"Ye hogyi mixing! Bass drop incoming. 🔊":"Surprise incoming… LET’S NACHOOOO! 🪩");
  transitionTo(prepared.track,prepared.hook,{automatic:true,mode:prepared.hook?"smart":"beginning",mixDuration:fadeSeconds});
}
function tickPlaybackEnd() {
  const t=cur(),a=audio();
  if(!t||a.paused||S.seeking||S.transitioning||S.mixing||S.endTriggered)return;
  let remaining;
  if(settings.playDurationMode==="skip") {
    const now=performance.now();
    if(S.playWindowLastTick==null)S.playWindowLastTick=now;
    S.playWindowRemaining=Math.max(0,(S.playWindowRemaining??settings.skipAfterSeconds)-(now-S.playWindowLastTick)/1000);
    S.playWindowLastTick=now; remaining=S.playWindowRemaining;
  } else {
    if(!Number.isFinite(a.duration)||a.duration<=0)return;
    remaining=Math.max(0,a.duration-a.currentTime);
  }
  if(settings.endAction==="pause") {
    if(remaining<=0){S.endTriggered=true;pausePlaybackWindow();a.pause();render();}
    return;
  }
  // Start local analysis early enough that the cue is ready before the transition.
  if(remaining<=Math.max(10,mixSec()+4)&&!S.preparedNext&&!S.preparingNext)prepareUpcomingTrack();
  if(remaining<=mixSec()&&S.preparedNext)startPreparedTransition(remaining);
  else if(remaining<=0&&!S.preparedNext) {
    S.endWaiting=true; pausePlaybackWindow(); a.pause();
    if(!S.preparingNext)prepareUpcomingTrack();
  }
}
async function handleNaturalTrackEnd() {
  if(S.transitioning||S.endTriggered)return;
  if(settings.endAction==="pause"){S.endTriggered=true;audio().pause();render();return;}
  await startPreparedTransition(0);
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
  const hook=settings.endAction==="smart"&&hooksOf(t).length?hooksOf(t)[Math.floor(Math.random()*hooksOf(t).length)]:null;
  transitionTo(t,hook,{manual:true,mode:hook?"smart":"beginning"});
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
  if($("#partySong")) $("#partySong").textContent=t?.title||"Nothing playing yet";
  if($("#partyArtist")) $("#partyArtist").textContent=t?.artist||"Choose your first track";
  if($("#partyPlay")) $("#partyPlay").textContent=audio().paused?"▶":"Ⅱ";
  $("#playState").textContent=audio().paused?"· PAUSED":"· PLAYING";
  $("#pp").textContent=audio().paused?"▶":"Ⅱ";
  $("#barPlay").textContent=audio().paused?"▶":"Ⅱ";
  $("#hookStatus").textContent=S.activeHook?`${S.activeHook.lyric||"Hook"} · ${fmt(S.activeHook.t)}`:"No hook selected";
  if($("#partySong")) $("#partySong").textContent=t?.title||"Nothing playing yet";
  if($("#partyArtist")) $("#partyArtist").textContent=t?.artist||"Choose your first track";
  if($("#partyPlay")) $("#partyPlay").textContent=audio().paused?"▶":"Ⅱ";
  if($("#partyAI")) $("#partyAI").textContent="Smart Mix: "+(settings.endAction==="smart"?"ON":"OFF");
  $("#shuffle").classList.toggle("active",S.shuffle);
  $("#repeat").classList.toggle("active",S.repeat);
  $("#queueCount").textContent=S.queue.length;
  const tracks=visibleTracks();
  $("#list").innerHTML=tracks.length?tracks.map((x,i)=>trackRow(x,i,"list")).join(""):'<div class="empty-state">Nothing here yet. Add songs to your GitHub songs folder or search Audius.</div>';
  const queuedNext=S.preparedNext?.track || S.preparingNext || S.queue[S.idx+1] || null;
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
  if(S.seeking)return;
  pausePlaybackWindow(); S.seeking=true; S.seekMoved=false; updateDJStatus();
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
  const a=audio(); if(!S.seeking)return;
  S.seeking=false;
  if(S.seekMoved) {
    S.preparedNext=null; S.preparingNext=null; S.preparationToken++;
    if(settings.playDurationMode==="skip") {
      S.playWindowRemaining=settings.skipAfterSeconds;
      S.playWindowLastTick=a.paused?null:performance.now();
      S.endTriggered=false; S.endWaiting=false;
    }
  } else if(settings.playDurationMode==="skip") {
    // A click/touch without moving the slider must resume the paused countdown.
    S.playWindowLastTick=a.paused?null:performance.now();
  }
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
$("#mixsec").onchange=e=>{settings.mixLength=[0,3,6,9].includes(+e.target.value)?+e.target.value:6;S.preparedNext=null;S.preparingNext=null;S.preparationToken++;saveSettings();};
$("#searchForm").onsubmit=e=>{e.preventDefault();const q=$("#searchInput").value.trim();searchAudius(q);};
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$("#refreshLibrary").onclick=async()=>{await initLib();toast(`Found ${S.lib.length} songs in GitHub.`);};
$("#exportHooks").onclick=exportHooksBackup;
$("#importHooks").onclick=()=>$("#importHooksFile").click();
$("#importHooksFile").onchange=e=>{importHooksBackup(e.target.files?.[0]);e.target.value="";};
$("#partyModeButton").onclick=async()=>{
  $("#partyMode").hidden=false; document.body.classList.add("party-mode-open");
  showPartyMessage("Surprise incoming… VIBE FLOW is taking over! 🪩");
  try { if(!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); } catch {}
};
$("#closeParty").onclick=async()=>{
  $("#partyMode").hidden=true; document.body.classList.remove("party-mode-open");
  try { if(document.fullscreenElement) await document.exitFullscreen?.(); } catch {}
};
$("#partyPlay").onclick=togglePlay;
$("#partyNext").onclick=next;
$("#partyPrev").onclick=previous;
$("#partyAI").onclick=toggleAIDJ;
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement && !$("#partyMode").hidden){$("#partyMode").hidden=true;document.body.classList.remove("party-mode-open");}});
$("#openSettings").onclick=openSettings; $("#footerSettings").onclick=openSettings;
function toggleAIDJ() {
  settings.endAction=settings.endAction==="smart"?"pause":"smart";
  S.preparedNext=null; S.preparingNext=null; S.preparationToken++; S.endTriggered=false;
  S.radio=settings.endAction==="smart";
  saveSettings(); syncControls(); render();
  toast(settings.endAction==="smart"?"Smart Mix enabled: random songs with randomly selected hooks.":"Automatic mixing paused. The current song will stop at its selected end point.");
}
$("#aiStatus").onclick=toggleAIDJ;
$("#aiRadio").onclick=toggleAIDJ;
A.forEach(a=>{
  a.volume=.8;
  a.onplay=()=>{if(a===audio()){if(settings.playDurationMode==="skip"&&S.playWindowLastTick==null&&!S.seeking)S.playWindowLastTick=performance.now();render();}};
  a.onpause=()=>{if(a===audio()){pausePlaybackWindow();render();}};
  a.ontimeupdate=()=>{
    if(a!==audio())return;
    if(a.duration){if(!S.seeking) $("#seek").value=a.currentTime/a.duration*1000;$("#time").textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;}
    if(!S.seeking)tickPlaybackEnd();
    updateDJStatus();
  };
  a.onended=()=>{if(a===audio()&&!S.transitioning)handleNaturalTrackEnd();};
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
    toast("VIBE FLOW SHORTCUTS · Space Play/Pause · ←/→ Seek 5s · ↑/↓ Volume · N Next · P Previous · A AI DJ · S Shuffle · R Repeat · M Mute");
  }
});

// ---------- Start ----------
(async()=>{
  syncControls();
  await initLib();
  switchView("library");
  if(cur()) render();
})();
