(()=>{"use strict";
const $=s=>document.querySelector(s),root=$("#partyAi"),state={tracks:[],index:0,remaining:[],playing:false,mode:"idle",fade:null,visual:null,drag:null,volume:.9,manifestSaved:false,skipBusy:false,skipToken:0,playToken:0,loaded:false,unlockClicks:0,unlockTimer:null,visualContext:null,musicAnalyser:null,musicSource:null};
const music=new Audio(),intro=new Audio(),scratch=new Audio();music.preload=intro.preload=scratch.preload="auto";music.volume=.9;intro.volume=.9;scratch.volume=.9;
let introContext=null,introGain=null;const introLevels=new Map();
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(n){if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");}
function track(){return state.tracks[state.index]||null;}
function say(s){const el=$("#paiStatus");if(el)el.textContent=s;}function stageSay(s){const el=$("#paiStageStatus");if(el)el.textContent=s;}
async function request(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
async function load(){
 say("Scanning party-mixes and matching introductions…");
 try{const d=await request("/api/party-library");state.tracks=d.tracks||[];state.effect=d.effect;state.manifestSaved=d.persistAvailable;state.loaded=true;mergeLocal();render();updateAssetCounts();say(state.tracks.length?state.tracks.length+" mixes ready · "+(state.manifestSaved?"GitHub metadata sync available":"browser-only metadata until Cloudflare secret is configured"):"No mixes found yet. Upload mix-01.mp3, mix-02.mp3… to party-mixes.");}
 catch(e){say(e.message+" · Check the Party with AI folders.");$("#paiList").innerHTML='<div class="pai-empty">'+esc(e.message)+'</div>';}
}
function updateAssetCounts(){const n=state.tracks.length;$("#paiVocalCount").textContent=n;$("#paiInstrumentCount").textContent=n;$("#paiIntroCount").textContent=state.tracks.filter(t=>!!t.intro).length;$("#paiEngineState").textContent=n?"READY":"STANDBY";}
function render(){
 const list=$("#paiList");if(!state.tracks.length){list.innerHTML='<div class="pai-empty">Your party mixes will appear here once uploaded to <b>party-mixes/</b>.</div>';return;}
 list.innerHTML=state.tracks.map((t,i)=>'<article class="pai-track" draggable="true" data-index="'+i+'"><span class="pai-number">'+String(i+1).padStart(2,"0")+'</span><div class="pai-track-main"><b>'+esc(t.title)+'</b><small>'+(t.intro?"Female DJ intro matched":"No intro · 2-second pause")+' · '+(t.bpm?t.bpm+" BPM":"BPM not set")+'</small><input class="pai-comment" data-comment="'+i+'" maxlength="240" placeholder="Write this mix’s unique DJ introduction…" value="'+esc(t.comment)+'"></div><label class="pai-bpm">BPM<input type="number" min="1" max="300" step="0.1" data-bpm="'+i+'" value="'+(t.bpm||"")+'" placeholder="—"></label><div class="pai-order"><button type="button" data-up="'+i+'" aria-label="Move up" '+(i===0?"disabled":"")+'>↑</button><button type="button" data-down="'+i+'" aria-label="Move down" '+(i===state.tracks.length-1?"disabled":"")+'>↓</button></div></article>').join("");
 list.querySelectorAll("[data-comment]").forEach(el=>el.onchange=()=>{state.tracks[+el.dataset.comment].comment=el.value;saveLocal();});
 list.querySelectorAll("[data-bpm]").forEach(el=>el.onchange=()=>{state.tracks[+el.dataset.bpm].bpm=Number(el.value)||null;saveLocal();render();});
 list.querySelectorAll("[data-up]").forEach(el=>el.onclick=()=>move(+el.dataset.up,-1));
 list.querySelectorAll("[data-down]").forEach(el=>el.onclick=()=>move(+el.dataset.down,1));
 list.querySelectorAll(".pai-track").forEach(el=>{el.ondragstart=()=>{state.drag=+el.dataset.index;el.classList.add("dragging");};el.ondragend=()=>el.classList.remove("dragging");el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();move(state.drag,+el.dataset.index-state.drag);};});
}
function move(i,delta){const j=i+delta;if(j<0||j>=state.tracks.length)return;const [x]=state.tracks.splice(i,1);state.tracks.splice(j,0,x);render();saveLocal();}
function saveLocal(){try{localStorage.setItem("vf_party_ai_tracks",JSON.stringify(state.tracks.map((t,i)=>({id:t.id,comment:t.comment||"",bpm:t.bpm||null,order:i}))));}catch{}}
function mergeLocal(){try{const saved=JSON.parse(localStorage.getItem("vf_party_ai_tracks")||"[]"),m=new Map(saved.map(x=>[x.id,x]));state.tracks=state.tracks.map(t=>({...t,...(m.get(t.id)||{})})).sort((a,b)=>(a.order??9999)-(b.order??9999));}catch{}}
async function save(){
 state.tracks.forEach((t,i)=>t.order=i);saveLocal();
 try{await request("/api/party-library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tracks:state.tracks})});state.manifestSaved=true;say("Playlist metadata saved to GitHub.");}
 catch(e){say("Saved in this browser. GitHub sync unavailable: "+e.message);}
}
function updateSkipControls(){
 const enabled=state.playing&&state.mode==="music"&&!state.skipBusy;
 ["#paiSkipBack45","#paiSkipBack30","#paiSkipBack15","#paiSkip15","#paiSkip30","#paiSkip45"].forEach(id=>{const button=$(id);if(button)button.disabled=!enabled;});
}
function setScreen(screen){root.dataset.screen=screen;$("#paiManage").hidden=screen!=="manage";$("#paiShow").hidden=screen==="manage";$("#paiShow").dataset.playing=String(state.playing);updateSkipControls();}
function open(){root.hidden=false;document.body.classList.add("party-ai-open");setScreen("show");if(!state.loaded)load();if(!state.visual)animate();}
function registerUnlockClick(){state.unlockClicks++;clearTimeout(state.unlockTimer);if(state.unlockClicks>=5){state.unlockClicks=0;setScreen("manage");say("Operator console unlocked.");return true;}state.unlockTimer=setTimeout(()=>{state.unlockClicks=0;},1700);return false;}
function launcherClick(){if(registerUnlockClick())return;open();}
function close(){stop();clearTimeout(state.unlockTimer);state.unlockClicks=0;root.hidden=true;document.body.classList.remove("party-ai-open");}
function ensureVisualAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!state.visualContext)state.visualContext=new C();if(state.visualContext.state==="suspended")state.visualContext.resume().catch(()=>{});if(!state.musicAnalyser){state.musicAnalyser=state.visualContext.createAnalyser();state.musicAnalyser.fftSize=256;state.musicAnalyser.smoothingTimeConstant=.82;state.musicSource=state.visualContext.createMediaElementSource(music);state.musicSource.connect(state.musicAnalyser);state.musicAnalyser.connect(state.visualContext.destination);}}catch(e){console.warn("Audio analysis unavailable; visual fallback active",e);}}
function fadeAudio(a,to,duration=850){return new Promise(resolve=>{if(a._fade){clearInterval(a._fade);a._fade=null;a._fadeResolve?.();}let settled=false;const done=()=>{if(settled)return;settled=true;if(a._fadeResolve===done)a._fadeResolve=null;resolve();};a._fadeResolve=done;const from=a.volume,start=performance.now();a._fade=setInterval(()=>{const p=Math.min(1,(performance.now()-start)/duration),e=p*p*(3-2*p);a.volume=from+(to-from)*e;if(p>=1){clearInterval(a._fade);a._fade=null;done();}},20);});}
async function prepareIntro(url){try{if(!introContext){const C=window.AudioContext||window.webkitAudioContext;if(C){introContext=new C();const source=introContext.createMediaElementSource(intro);introGain=introContext.createGain();const compressor=introContext.createDynamicsCompressor();compressor.threshold.value=-20;compressor.knee.value=18;compressor.ratio.value=3;compressor.attack.value=.008;compressor.release.value=.22;source.connect(compressor).connect(introGain).connect(introContext.destination);}}if(introContext?.state==="suspended")await introContext.resume();if(introContext&&introGain&&!introLevels.has(url)){let gain=1;try{const response=await fetch(url);if(response.ok){const decoded=await introContext.decodeAudioData(await response.arrayBuffer());let sum=0,count=0;for(let ch=0;ch<decoded.numberOfChannels;ch++){const data=decoded.getChannelData(ch),stride=Math.max(1,Math.floor(data.length/120000));for(let i=0;i<data.length;i+=stride){sum+=data[i]*data[i];count++;}}const rms=count?Math.sqrt(sum/count):0;if(rms>0.0001)gain=Math.max(.55,Math.min(2.8,.14/rms));}}catch(e){console.warn("Intro loudness analysis unavailable; using compressor only",e);}introLevels.set(url,gain);}if(introGain)introGain.gain.value=introLevels.get(url)||1;}catch(e){console.warn("Intro loudness processor unavailable",e);}}
async function playCurrent(){
 clearTimeout(state.timer);const token=++state.playToken;
 const t=track();if(!t)return finish();
 state.playing=true;setScreen("show");$("#paiStartPanel").hidden=true;$("#paiShow").dataset.playing="true";$("#paiComment").textContent=t.comment||"Bengaluru, are you ready? Let the room hear you!";$("#paiComment").classList.add("visible");$("#paiCrowdPrompt").textContent="DJ MIC IS LIVE · MAKE SOME NOISE";$("#paiEngineState").textContent="ENGAGED";ensureVisualAudio();
 music.pause();intro.pause();music.src=t.file;music.currentTime=0;music.volume=0;
 if(t.intro){try{state.mode="intro";updateSkipControls();$("#paiPhase").textContent="DJ MIC · INTRO CUE";stageSay("VOICE DROP IN PROGRESS");await prepareIntro(t.intro);if(token!==state.playToken||!state.playing)return;intro.src=t.intro;intro.currentTime=0;intro.volume=.9;await intro.play();$("#paiComment").classList.toggle("visible",!!t.comment);say("DJ intro is live.");stageSay("DJ INTRO · LIVE VOICE CUE");intro.onended=()=>{if(state.playing&&token===state.playToken)startMusic(true,token);};}catch(e){console.warn("Intro playback failed",e);state.timer=setTimeout(()=>{if(state.playing&&token===state.playToken)startMusic(true,token);},2000);}}
 else{state.mode="pause";updateSkipControls();$("#paiPhase").textContent="BUILDING THE DROP";$("#paiComment").textContent="Hold that energy… the next moment is loading.";$("#paiComment").classList.add("visible");stageSay("PREPARING NEXT AUDIO CUE");say("No intro cue on this mix · short transition.");state.timer=setTimeout(()=>{if(state.playing&&token===state.playToken)startMusic(true,token);},2000);}
}
async function startMusic(resetPosition=true,token=state.playToken){if(!state.playing||token!==state.playToken)return;intro.pause();state.mode="music";updateSkipControls();$("#paiPhase").textContent="LIVE MIX · SIGNAL LOCKED";$("#paiComment").textContent=["Hands up if you are feeling this!","Stay with me — we are taking the energy higher.","Let me hear you! This one is for the whole room.","Do not stop now. Feel that rhythm!"][Math.floor(Math.random()*4)];$("#paiComment").classList.add("visible");stageSay("LIVE AUDIO · MIX ENGINE ACTIVE");$("#paiCrowdPrompt").textContent="THE ROOM IS YOURS · KEEP IT MOVING";try{if(resetPosition)music.currentTime=0;music.volume=0;await music.play();if(token!==state.playToken)return;await fadeAudio(music,state.volume,resetPosition?1100:500);if(token===state.playToken)say("Live performance audio is running.");}catch(e){if(token===state.playToken){say("Could not play this mix: "+e.message);next();}}}
function chooseNextIndex(){
 if(!state.remaining.length)return -1;
 if(state.playOrder==="chronological")return state.remaining.shift();
 const currentBpm=Number(track()?.bpm);
 const known=state.remaining.filter(i=>Number(state.tracks[i]?.bpm)>0);
 if(!Number.isFinite(currentBpm)||currentBpm<=0||!known.length){
  const pick=Math.floor(Math.random()*state.remaining.length);
  return state.remaining.splice(pick,1)[0];
 }
 const ranked=known.map(i=>({index:i,diff:Math.abs(Number(state.tracks[i].bpm)-currentBpm)})).sort((a,b)=>a.diff-b.diff);
 const closest=ranked[0].diff;
 // Randomize among close BPM matches instead of always following a fixed sequence.
 const tolerance=Math.max(3,closest+2);
 const pool=ranked.filter(x=>x.diff<=tolerance);
 const chosen=pool[Math.floor(Math.random()*pool.length)].index;
 state.remaining.splice(state.remaining.indexOf(chosen),1);
 return chosen;
}
function next(){
 state.skipToken++;state.skipBusy=false;
 const chosen=chooseNextIndex();
 if(chosen>=0){state.index=chosen;playCurrent();}
 else finish();
}
function finish(){state.playing=false;state.mode="done";state.skipBusy=false;music.pause();intro.pause();setScreen("show");$("#paiPhase").textContent="SESSION COMPLETE";$("#paiComment").textContent="That was a moment. Want to run it back?";$("#paiComment").classList.add("visible");$("#paiStartPanel").hidden=false;$("#paiEngineState").textContent="STANDBY";stageSay("READY FOR ANOTHER SET");say("All party mixes played.");}
function stop(){clearTimeout(state.timer);state.skipToken++;state.playToken++;state.playing=false;state.skipBusy=false;music.pause();intro.pause();scratch.pause();clearInterval(music._fade);music._fade=null;music._fadeResolve?.();clearInterval(intro._fade);intro._fade=null;intro._fadeResolve?.();music.volume=state.volume;if(state.visual)cancelAnimationFrame(state.visual);state.visual=null;setScreen("show");$("#paiStartPanel").hidden=false;stageSay("ENGINE STANDBY");}
async function skipBy(offset){
 if(!state.playing||state.mode!=="music"||state.skipBusy)return;
 const activeTrack=track(),duration=music.duration,current=music.currentTime;
 if(!Number.isFinite(current)||!Number.isFinite(duration)||duration<=0)return;
 const target=Math.max(0,Math.min(duration,current+offset));
 const goesPastEnd=offset>0&&current+offset>=duration;
 const operation=++state.skipToken;
 state.skipBusy=true;updateSkipControls();
 try{
  await fadeAudio(music,0,180);
  if(operation!==state.skipToken||!state.playing||state.mode!=="music"||track()!==activeTrack)return;
  music.pause();
  if(goesPastEnd){state.skipBusy=false;next();return;}
  if(Math.abs(music.currentTime-target)>0.05){
   await new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);music.removeEventListener("seeked",onSeeked);music.removeEventListener("error",onError);};
    const finish=(error)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error("Audio seek timed out; position not confirmed")),3000);
    const onSeeked=()=>finish();
    const onError=()=>finish(new Error("Audio seek failed"));
    music.addEventListener("seeked",onSeeked,{once:true});
    music.addEventListener("error",onError,{once:true});
    try{music.currentTime=target;}catch(e){finish(e);}
   });
  }
  if(operation!==state.skipToken||!state.playing||state.mode!=="music"||track()!==activeTrack)return;
  scratchPlay();
  await startMusic(false,state.playToken);
 }catch(e){
  if(operation===state.skipToken){
   say("Skip failed: "+e.message);
   if(state.playing&&state.mode==="music")try{await startMusic(false,state.playToken);}catch{}
  }
 }finally{
  if(operation===state.skipToken)state.skipBusy=false;
  if(state.playing&&state.mode==="music")music.volume=state.volume;
  updateSkipControls();
 }
}
function scratchPlay(){
 return new Promise(resolve=>{
  if(!state.effect){resolve();return;}
  const vinyls=[...root.querySelectorAll(".pai-vinyl")];
  let settled=false;
  const finishScratch=()=>{if(settled)return;settled=true;clearTimeout(fallback);scratch.onended=null;scratch.onerror=null;vinyls.forEach(el=>el.classList.remove("scratching"));resolve();};
  const fallback=setTimeout(finishScratch,2600);
  scratch.pause();scratch.src=state.effect;scratch.currentTime=0;scratch.volume=.95;
  vinyls.forEach(el=>el.classList.add("scratching"));
  scratch.onended=finishScratch;scratch.onerror=finishScratch;
  scratch.play().catch(finishScratch);
 });
}
function animate(){const c=$("#paiViz"),ctx=c.getContext("2d");let w,h;const draw=()=>{if(root.hidden||root.dataset.screen!=="show"){state.visual=null;return;}w=c.width=c.clientWidth*devicePixelRatio;h=c.height=c.clientHeight*devicePixelRatio;ctx.clearRect(0,0,w,h);const bars=state.musicAnalyser&&state.mode==="music"?new Uint8Array(state.musicAnalyser.frequencyBinCount):null;if(bars)state.musicAnalyser.getByteFrequencyData(bars);const time=performance.now()/1000;for(let i=0;i<72;i++){const x=(i+.5)*w/72,raw=bars?bars[Math.floor(i/72*bars.length)]/255:(.12+Math.abs(Math.sin(time*2+i*.53))*.55),amp=(.08+raw*.88)*h*.39;ctx.fillStyle="rgba(183,126,255,"+(.24+raw*.7)+")";ctx.fillRect(x,h/2-amp,Math.max(2,w/125),amp*2);}state.visual=requestAnimationFrame(draw);};draw();}
function bind(){
 $("#partyAiOpen").onclick=launcherClick;$("#paiShowUnlock").onclick=()=>{if(registerUnlockClick())return;stageSay("PLAY WITH AI · "+state.unlockClicks+"/5");};$("#paiClose").onclick=close;$("#paiRefresh").onclick=()=>{state.loaded=false;load();};$("#paiSave").onclick=save;$("#paiReturnShow").onclick=()=>{setScreen("show");if(!state.visual)animate();stageSay(state.playing?"LIVE PERFORMANCE CONTINUES":"ENGINE STANDBY");};$("#paiStart").onclick=()=>{setScreen("show");if(!state.visual)animate();};
 $("#paiShuffleStart").onclick=()=>{if(!state.tracks.length)return say("No pre-mixed audio assets found.");state.playOrder="shuffle";$("#paiStartPanel").hidden=true;state.remaining=state.tracks.map((_,i)=>i);const first=Math.floor(Math.random()*state.remaining.length);state.index=state.remaining.splice(first,1)[0];playCurrent();animate();};
 $("#paiChronologicalStart").onclick=()=>{if(!state.tracks.length)return say("No pre-mixed audio assets found.");state.playOrder="chronological";$("#paiStartPanel").hidden=true;state.remaining=state.tracks.map((_,i)=>i);state.index=state.remaining.shift();playCurrent();animate();};
 $("#paiPause").onclick=()=>{state.skipToken++;state.skipBusy=false;clearInterval(music._fade);music._fade=null;music._fadeResolve?.();music.volume=state.volume;music.pause();intro.pause();state.playing=false;$("#paiShow").dataset.playing="false";updateSkipControls();stageSay("PERFORMANCE PAUSED");};
 $("#paiResume").onclick=()=>{if(state.mode==="done"){state.remaining=state.tracks.map((_,i)=>i);if(state.playOrder==="chronological")state.index=state.remaining.shift();else{const first=Math.floor(Math.random()*state.remaining.length);state.index=state.remaining.splice(first,1)[0];}playCurrent();}else if(state.mode==="music"){music.play();state.playing=true;$("#paiShow").dataset.playing="true";updateSkipControls();}else if(state.mode==="intro"){intro.play();state.playing=true;$("#paiShow").dataset.playing="true";updateSkipControls();}else playCurrent();};
 $("#paiNext").onclick=()=>{music.pause();intro.pause();next();};
 $("#paiSkipBack45").onclick=()=>skipBy(-45);$("#paiSkipBack30").onclick=()=>skipBy(-30);$("#paiSkipBack15").onclick=()=>skipBy(-15);$("#paiSkip15").onclick=()=>skipBy(15);$("#paiSkip30").onclick=()=>skipBy(30);$("#paiSkip45").onclick=()=>skipBy(45);updateSkipControls();
 $("#paiBack").onclick=()=>{stop();if(!state.visual)animate();say("Session stopped.");};
 music.ontimeupdate=()=>{$("#paiProgress").style.width=(music.duration?music.currentTime/music.duration*100:0)+"%";$("#paiClock").textContent=fmt(music.currentTime)+" / "+fmt(music.duration);};
 music.onended=()=>{if(state.playing)next();};
}
document.addEventListener("DOMContentLoaded",()=>{bind();});
})();