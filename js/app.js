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
  aiEnabled: true, autoMode: "random", autoAdvance: true
};
const settings = { ...defaults, ...store.get("settings", {}) };
const S = {
  queue: store.get("queue", []), idx: store.get("idx", -1),
  favs: store.get("favs", []), hist: store.get("hist", []),
  patterns: store.get("patterns", []), hookPlays: store.get("hookPlays", {}),
  trackPlays: store.get("trackPlays", {}), radio: false, shuffle: false,
  repeat: false, view: "discover", results: [], recs: [], busy: false,
  tok: 0, mixing: false, transitioning: false, activeHook: null,
  transitionTimer: null, env: {}, lib: [], dragIndex: null
};
const save = () => {
  for (const [k, v] of Object.entries({
    queue:S.queue, idx:S.idx, favs:S.favs, hist:S.hist,
    patterns:S.patterns, hookPlays:S.hookPlays, trackPlays:S.trackPlays
  })) store.set(k, v);
};
const saveSettings = () => store.set("settings", settings);
const toast = msg => {
  const el = $("#toast"); el.textContent = msg; el.style.display = "block";
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = "none", 3800);
};
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => Number.isFinite(+n) ? `${Math.floor(+n/60)}:${String(Math.floor(+n%60)).padStart(2,"0")}` : "0:00";
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
      <div class="setting-field"><label for="setHookDuration">Play time after hook start</label><input id="setHookDuration" type="number" min="5" max="300" step="1" value="${settings.hookPlaySeconds}"><small>Used when that hook has no marked end.</small></div>
      <div class="setting-field"><label for="setNoHook">Fallback time without a hook end</label><input id="setNoHook" type="number" min="5" max="600" step="5" value="${settings.noHookSeconds}"><small>Switch after this many seconds if no hook end is available.</small></div>
      <div class="setting-field"><label for="setNoHookStart">Start position when no hook is saved</label><input id="setNoHookStart" type="number" min="0" max="300" step="1" value="${settings.noHookStartSeconds}"><small>Start unmarked songs at this position. Default: 20 seconds.</small></div>
      <div class="setting-field"><label for="setMode">Automatic mix mode</label><select id="setMode"><option value="random">Random / smart</option><option value="hook">Always choose a saved hook</option><option value="beginning">Start at song beginning</option><option value="off">Off</option></select><small>Controls how automatic transitions choose the next start point.</small></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button data-close="1">Cancel</button><button id="saveSettings" class="primary-btn">Save settings</button></div>
  </div></div>`;
  $("#setMix").value = String(settings.mixLength);
  $("#setMode").value = settings.autoMode;
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
    settings.autoMode = $("#setMode").value;
    saveSettings(); root.innerHTML=""; syncControls(); render();
    toast("DJ settings saved.");
  };
}
function syncControls() {
  $("#mixsec").value = String(settings.mixLength);
  $("#autoMode").value = settings.autoMode;
  $("#aiStatus").classList.toggle("off",!settings.aiEnabled);
  $("#aiStatus").innerHTML = `<span class="ai-dot"></span> AI ${settings.aiEnabled?"ON":"OFF"}`;
  $("#aiRadio").style.display = settings.aiEnabled ? "" : "none";
  if (!settings.aiEnabled && S.radio) { S.radio=false; $("#aiRadio").textContent="AI Radio: Off"; }
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
  const h={id:crypto.randomUUID?.() || String(Date.now()),t:+audio().currentTime.toFixed(2),end:null,lyric:label,endLyric:""};
  entry.hooks=[...hooksOf(entry),h].sort((a,b)=>a.t-b.t);
  t.hooks=entry.hooks; S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:null};
  $("#hookLabel").value=""; saveLib(); save(); renderHooks(); render();
  toast(`Hook marked at ${fmt(h.t)}. Mark its end when the hook finishes.`);
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
  S.activeHook={trackId:t.id,hookId:h.id,t:h.t,end:h.end ?? null};
  markHookPlayed(t,h);
  $("#hookStatus").textContent=`${h.lyric || "Hook"} · ${fmt(h.t)}`;
  toast(`Jumped directly to ${fmt(h.t)}.`);
}
function renderHooks() {
  const t=cur(), hooks=hooksOf(t);
  $("#hookCount").textContent=`${hooks.length} saved`;
  if(!t || t.provider!=="mine") {
    $("#hooksList").innerHTML='<div class="empty-state">Hooks can be marked on songs in My music.</div>';
    return;
  }
  if(!hooks.length) {
    $("#hooksList").innerHTML='<div class="empty-state">No hooks yet. Play the song and press “Mark hook here”.</div>';
    return;
  }
  $("#hooksList").innerHTML=hooks.map((h,i)=>`
    <div class="hook-item">
      <span class="hook-time">${fmt(h.t)}</span>
      <div class="hook-detail"><b>${esc(h.lyric || "Hook "+(i+1))}</b><small>${h.end!=null?`Ends ${fmt(h.end)}${h.endLyric?" · "+esc(h.endLyric):""}`:"End not marked"}</small></div>
      <button data-hook-go="${esc(h.id)}" title="Jump exactly to hook">Go</button>
      <input id="endLine-${esc(h.id)}" aria-label="Hook ending lyric" placeholder="End line" style="width:90px;padding:6px;font-size:10px">
      <button data-hook-end="${esc(h.id)}" title="Mark hook end here">Mark end</button>
      <button data-hook-delete="${esc(h.id)}" title="Delete hook">×</button>
    </div>`).join("");
  $("#hooksList").querySelectorAll("[data-hook-go]").forEach(b=>b.onclick=()=>playHookDirect(hooks.find(h=>String(h.id)===b.dataset.hookGo)));
  $("#hooksList").querySelectorAll("[data-hook-end]").forEach(b=>b.onclick=()=>markHookEnd(b.dataset.hookEnd));
  $("#hooksList").querySelectorAll("[data-hook-delete]").forEach(b=>b.onclick=()=>deleteHook(b.dataset.hookDelete));
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
  if(!from || !to || !hook) return;
  const found=S.patterns.find(p=>p.from===from.id && p.to===to.id && String(p.hookId)===String(hook.id));
  if(found) found.count++;
  else S.patterns.push({from:from.id,to:to.id,hookId:hook.id,hookT:hook.t,label:hook.lyric||"Hook",count:1});
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
  if(S.radio && settings.aiEnabled && S.recs.length) return S.recs.shift();
  const patterns=rememberedFor(current);
  for(const p of patterns) {
    const f=pool.find(x=>"my:"+x.file===p.to);
    if(f && hooksOf(f).some(h=>String(h.id)===String(p.hookId))) return toTrack(f);
  }
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
function showTransition(track,hook,automatic=true) {
  const banner=$("#transitionBanner");
  $("#transitionTitle").textContent=settings.aiEnabled?"AI analysing the best next track":"DJ engine preparing the next track";
  $("#transitionText").textContent=`Switching to ${track.title}${hook?` · ${hook.lyric||"saved hook"} at ${fmt(hook.t)}`:" · beginning"}…`;
  $("#transitionCaption").textContent=`Next: ${track.title}`;
  $("#engineState").textContent="ANALYSING";
  banner.classList.add("show");
  clearTimeout(showTransition.timer);
  showTransition.timer=setTimeout(()=>{banner.classList.remove("show");$("#engineState").textContent="READY";},Math.max(1800,mixSec()*1000+500));
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
  render(); // Keep the upcoming queue visible while the next track is prepared.
  const startAt=hook ? mixStartForHook(hook) : ((automatic || mode==="no-hook") ? settings.noHookStartSeconds : 0);
  showTransition(track,hook,automatic);
  try {
    const url=await getUrl(track);
    if(token!==S.tok) return;
    const old=audio(), nextAudio=A[1-ci], wasPlaying=!old.paused;
    clearInterval(nextAudio._fade); nextAudio.pause(); nextAudio.src=url; nextAudio.volume=0;
    await waitMetadata(nextAudio);
    if(startAt>0 && Number.isFinite(nextAudio.duration)) nextAudio.currentTime=Math.min(startAt,Math.max(0,nextAudio.duration-1));
    await nextAudio.play();
    if(token!==S.tok){nextAudio.pause();return;}
    ci=1-ci;
    if(mixSec()===0) {
      // Crossfade disabled: switch decks instantly without overlapping audio.
      old.pause(); old.removeAttribute("src"); old.load();
      nextAudio.volume=vol(); S.mixing=false; S.transitioning=false;
    } else {
      S.mixing=true;
      if(wasPlaying) fade(old,0,mixSec()*1000,()=>{old.pause();old.removeAttribute("src");old.load();});
      else old.pause();
      fade(nextAudio,vol(),mixSec()*1000,()=>{S.mixing=false;S.transitioning=false;});
    }
    S.activeHook=hook?{trackId:track.id,hookId:hook.id,t:hook.t,end:hook.end??null,lyric:hook.lyric||"Hook"}:null;
    if(hook) markHookPlayed(track,hook);
    if(previous && hook) rememberPattern(previous,track,hook);
    S.hist=[track,...S.hist.filter(x=>x.id!==track.id)].slice(0,100);
    save();
    if(settings.aiEnabled) suggest();
    render(); renderHooks();
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
function nextAutomatic() {
  if(!settings.autoAdvance || settings.autoMode==="off") return;
  const t=pickNextTrack();
  if(!t) { toast("Add more tracks to My music for automatic DJ playback."); return; }
  let hook=null;
  if(settings.autoMode==="hook") {
    const remembered=rememberedFor(cur()).find(p=>p.to===t.id);
    const candidate=remembered && hooksOf(t).find(h=>String(h.id)===String(remembered.hookId));
    const least=hooksOf(t).length?Math.min(...hooksOf(t).map(h=>S.hookPlays[hookKey(t,h)]||0)):Infinity;
    hook=candidate && (S.hookPlays[hookKey(t,candidate)]||0)===least ? candidate : fairHook(t);
  }
  transitionTo(t,hook,{automatic:true,mode:settings.autoMode});
}
function handleAutoAdvance() {
  if(!settings.autoAdvance || settings.autoMode==="off" || S.transitioning || S.mixing) return;
  nextAutomatic();
}
function checkHookTimer() {
  const t=cur(), a=audio(); if(!t || a.paused || S.transitioning || S.mixing) return;
  const h=S.activeHook && S.activeHook.trackId===t.id ? S.activeHook : null;
  if(h) {
    const deadline=h.end!=null ? h.end : h.t+settings.hookPlaySeconds;
    if(a.currentTime>=deadline) handleAutoAdvance();
  } else if(a.currentTime>=settings.noHookSeconds) {
    handleAutoAdvance();
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
  const art=t.art||"";
  const buttons=where==="queue"
    ? `<button data-remove="${i}">Remove</button>`
    : `<button data-play="${esc(t.id)}">Play</button><button data-play-next="${esc(t.id)}">Play next</button><button data-add="${esc(t.id)}">Queue</button>`;
  return `<div class="track-row ${current?"current":""}" ${where==="queue"?`draggable="true" data-queue-index="${i}"`:""}>
    <img class="track-art" src="${esc(art)}" alt="">
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
  $("#art").src=t?.art||"";
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
  renderHooks();
  $("#waveform").classList.toggle("paused",audio().paused);
  if(!$("#waveform").children.length) $("#waveform").innerHTML=Array.from({length:36},(_,i)=>`<i style="height:${8+((i*17)%34)}px;animation-delay:${-(i%9)*.13}s"></i>`).join("");
  syncControls();
  bindTrackActions();
}
function bindTrackActions() {
  document.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.play;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(track) playTrack(track);
  });
  document.querySelectorAll("[data-play-next]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.playNext;
    const track=[...S.lib.map(toTrack),...S.results,...S.recs,...S.favs,...S.hist].find(x=>x.id===id);
    if(track){addQueue(track,"next");toast(`${track.title} will play next.`);}
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
$("#mix").onclick=mixNext;
$("#prev").onclick=previous; $("#barPrev").onclick=previous;
$("#next").onclick=next; $("#barNext").onclick=next;
$("#pp").onclick=togglePlay; $("#barPlay").onclick=togglePlay;
function togglePlay() {
  const a=audio();
  if(a.paused) {
    if(!a.src && cur()) playTrack(cur());
    else a.play().then(()=>{a.volume=vol();render();}).catch(()=>toast("Press play to start audio."));
  } else a.pause();
}
$("#shuffle").onclick=()=>{S.shuffle=!S.shuffle;$("#shuffle").classList.toggle("active",S.shuffle);};
$("#repeat").onclick=()=>{S.repeat=!S.repeat;$("#repeat").classList.toggle("active",S.repeat);};
$("#vol").oninput=()=>{if(!S.mixing)audio().volume=vol();};
$("#seek").oninput=e=>{if(audio().duration)audio().currentTime=audio().duration*e.target.value/1000;};
$("#mixsec").onchange=e=>{settings.mixLength=[0,3,6,9].includes(+e.target.value)?+e.target.value:6;saveSettings();};
$("#autoMode").onchange=e=>{settings.autoMode=e.target.value;saveSettings();};
$("#searchForm").onsubmit=e=>{e.preventDefault();const q=$("#searchInput").value.trim();searchAudius(q);};
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$("#refreshLibrary").onclick=async()=>{await initLib();toast(`Found ${S.lib.length} songs in GitHub.`);};
$("#openSettings").onclick=openSettings; $("#footerSettings").onclick=openSettings;
$("#aiStatus").onclick=()=>{settings.aiEnabled=!settings.aiEnabled;saveSettings();syncControls();toast(`AI ${settings.aiEnabled?"enabled":"disabled"}.`);if(settings.aiEnabled)suggest();};
$("#aiRadio").onclick=()=>{if(!settings.aiEnabled)return;S.radio=!S.radio;$("#aiRadio").textContent=`AI Radio: ${S.radio?"On":"Off"}`;if(S.radio)suggest();};
A.forEach(a=>{
  a.volume=.8;
  a.onplay=render; a.onpause=render;
  a.ontimeupdate=()=>{
    if(a!==audio())return;
    if(a.duration){$("#seek").value=a.currentTime/a.duration*1000;$("#time").textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;}
    checkHookTimer();
  };
  a.onended=()=>{if(a===audio()&&!S.transitioning&&settings.autoAdvance&&settings.autoMode!=="off")nextAutomatic();};
  a.onerror=()=>{if(a===audio()&&a.src)toast("This audio file could not be played. Check the file URL and format.");};
});
$("#modalRoot").addEventListener("click",e=>{if(e.target.classList.contains("modal-backdrop")&&e.target.dataset.dismiss)$("#modalRoot").innerHTML="";});
window.addEventListener("keydown",e=>{if(e.key==="Escape")$("#modalRoot").innerHTML="";});

// ---------- Start ----------
(async()=>{
  syncControls();
  await initLib();
  await searchAudius();
  if(cur()) render();
})();
