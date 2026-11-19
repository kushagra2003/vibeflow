(()=>{"use strict";
const $=s=>document.querySelector(s),root=$("#partyAi"),state={tracks:[],index:0,remaining:[],playing:false,mode:"idle",fade:null,visual:null,drag:null,volume:.9,manifestSaved:false,skipBusy:false,playToken:0};
const music=new Audio(),intro=new Audio(),scratch=new Audio();music.preload=intro.preload=scratch.preload="auto";music.volume=.9;intro.volume=.9;scratch.volume=.9;
let introContext=null,introGain=null;const introLevels=new Map();
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(n){if(!Number.isFinite(n))return"0:00";return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");}
function track(){return state.tracks[state.index]||null;}
function say(s){$("#paiStatus").textContent=s;}
async function request(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
async function load(){
 say("Scanning party-mixes and matching introductions…");
 try{const d=await request("/api/party-library");state.tracks=d.tracks||[];state.effect=d.effect;state.manifestSaved=d.persistAvailable;render();say(state.tracks.length?state.tracks.length+" mixes ready · "+(state.manifestSaved?"GitHub metadata sync available":"browser-only metadata until Cloudflare secret is configured"):"No mixes found yet. Upload mix-01.mp3, mix-02.mp3… to party-mixes.");}
 catch(e){say(e.message+" · Check the Party with AI folders.");$("#paiList").innerHTML='<div class="pai-empty">'+esc(e.message)+'</div>';}
}
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
function setScreen(screen){root.dataset.screen=screen;$("#paiManage").hidden=screen!=="manage";$("#paiPlay").hidden=screen==="manage";$("#paiPlay").dataset.playing=String(state.playing);updateSkipControls();}
function open(){root.hidden=false;document.body.classList.add("party-ai-open");load().then(()=>{mergeLocal();render();});}
function close(){stop();root.hidden=true;document.body.classList.remove("party-ai-open");}
function fadeAudio(a,to,duration=850){return new Promise(resolve=>{clearInterval(a._fade);const from=a.volume,start=performance.now();a._fade=setInterval(()=>{const p=Math.min(1,(performance.now()-start)/duration),e=p*p*(3-2*p);a.volume=from+(to-from)*e;if(p>=1){clearInterval(a._fade);a._fade=null;resolve();}},20);});}
async function prepareIntro(url){try{if(!introContext){const C=window.AudioContext||window.webkitAudioContext;if(C){introContext=new C();const source=introContext.createMediaElementSource(intro);introGain=introContext.createGain();const compressor=introContext.createDynamicsCompressor();compressor.threshold.value=-20;compressor.knee.value=18;compressor.ratio.value=3;compressor.attack.value=.008;compressor.release.value=.22;source.connect(compressor).connect(introGain).connect(introContext.destination);}}if(introContext?.state==="suspended")await introContext.resume();if(introContext&&introGain&&!introLevels.has(url)){let gain=1;try{const response=await fetch(url);if(response.ok){const decoded=await introContext.decodeAudioData(await response.arrayBuffer());let sum=0,count=0;for(let ch=0;ch<decoded.numberOfChannels;ch++){const data=decoded.getChannelData(ch),stride=Math.max(1,Math.floor(data.length/120000));for(let i=0;i<data.length;i+=stride){sum+=data[i]*data[i];count++;}}const rms=count?Math.sqrt(sum/count):0;if(rms>0.0001)gain=Math.max(.55,Math.min(2.8,.14/rms));}}catch(e){console.warn("Intro loudness analysis unavailable; using compressor only",e);}introLevels.set(url,gain);}if(introGain)introGain.gain.value=introLevels.get(url)||1;}catch(e){console.warn("Intro loudness processor unavailable",e);}}
async function playCurrent(){
 clearTimeout(state.timer);const token=++state.playToken;
 const t=track();if(!t)return finish();
 state.playing=true;setScreen("play");$("#paiNowTitle").textContent=t.title;$("#paiComment").textContent=t.comment||"";$("#paiComment").classList.toggle("has-copy",!!t.comment);
 music.pause();intro.pause();music.src=t.file;music.currentTime=0;music.volume=0;
 if(t.intro){try{state.mode="intro";updateSkipControls();$("#paiPhase").textContent="DJ INTRO";await prepareIntro(t.intro);if(token!==state.playToken||!state.playing)return;intro.src=t.intro;intro.currentTime=0;intro.volume=.9;await intro.play();$("#paiComment").classList.toggle("visible",!!t.comment);say("Introducing "+t.title);intro.onended=()=>{if(state.playing&&token===state.playToken)startMusic(true,token);};}catch(e){console.warn("Intro playback failed",e);state.timer=setTimeout(()=>{if(state.playing&&token===state.playToken)startMusic(true,token);},2000);}}
 else{state.mode="pause";updateSkipControls();$("#paiPhase").textContent="NEXT MIX";$("#paiComment").classList.remove("visible");say("No intro found for "+t.title+" · starting in 2 seconds");state.timer=setTimeout(()=>{if(state.playing&&token===state.playToken)startMusic(true,token);},2000);}
}
async function startMusic(resetPosition=true,token=state.playToken){if(!state.playing||token!==state.playToken)return;intro.pause();state.mode="music";updateSkipControls();$("#paiPhase").textContent="NOW PLAYING";$("#paiComment").classList.remove("visible");try{if(resetPosition)music.currentTime=0;music.volume=0;await music.play();if(token!==state.playToken)return;await fadeAudio(music,state.volume,resetPosition?1100:500);if(token===state.playToken)say("Playing "+track().title);}catch(e){if(token===state.playToken){say("Could not play this mix: "+e.message);next();}}}
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
 const chosen=chooseNextIndex();
 if(chosen>=0){state.index=chosen;playCurrent();}
 else finish();
}
function finish(){state.playing=false;state.mode="done";state.skipBusy=false;music.pause();intro.pause();setScreen("done");$("#paiPhase").textContent="SESSION COMPLETE";$("#paiNowTitle").textContent="That’s a wrap.";$("#paiComment").textContent="Your party set has finished.";$("#paiComment").classList.add("visible");say("All party mixes played.");}
function stop(){clearTimeout(state.timer);state.playToken++;state.playing=false;state.skipBusy=false;music.pause();intro.pause();scratch.pause();clearInterval(music._fade);clearInterval(intro._fade);if(state.visual)cancelAnimationFrame(state.visual);state.visual=null;setScreen("manage");}
async function skipBy(offset){
 if(!state.playing||state.mode!=="music"||state.skipBusy)return;
 const activeTrack=track(),duration=music.duration,current=music.currentTime;
 if(!Number.isFinite(current)||!Number.isFinite(duration)||duration<=0)return;
 const target=Math.max(0,Math.min(duration,current+offset));
 const goesPastEnd=offset>0&&current+offset>=duration;
 state.skipBusy=true;updateSkipControls();
 try{
  await fadeAudio(music,0,180);
  music.pause();
  if(!state.playing||state.mode!=="music"||track()!==activeTrack)return;
  if(goesPastEnd){state.skipBusy=false;next();return;}
  // Seek first, wait for the browser to apply it, then resume without resetting to 0.
  if(Math.abs(music.currentTime-target)>0.05){
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();resolve();},900);
    const cleanup=()=>{clearTimeout(timer);music.removeEventListener("seeked",onSeeked);music.removeEventListener("error",onError);};
    const onSeeked=()=>{cleanup();resolve();};
    const onError=()=>{cleanup();reject(new Error("Audio seek failed"));};
    music.addEventListener("seeked",onSeeked,{once:true});
    music.addEventListener("error",onError,{once:true});
    music.currentTime=target;
   });
  }
  if(!state.playing||state.mode!=="music"||track()!==activeTrack)return;
  scratchPlay();
  await startMusic(false,state.playToken);
 }catch(e){say("Skip failed: "+e.message);}
 finally{state.skipBusy=false;updateSkipControls();}
}
function scratchPlay(){
 return new Promise(resolve=>{
  if(!state.effect){resolve();return;}
  let settled=false;
  const finishScratch=()=>{if(settled)return;settled=true;clearTimeout(fallback);scratch.onended=null;scratch.onerror=null;$("#paiDisc").classList.remove("scratching");resolve();};
  const fallback=setTimeout(finishScratch,2600);
  scratch.pause();scratch.src=state.effect;scratch.currentTime=0;scratch.volume=.95;
  $("#paiDisc").classList.add("scratching");
  scratch.onended=finishScratch;scratch.onerror=finishScratch;
  scratch.play().catch(finishScratch);
 });
}
function animate(){const c=$("#paiViz"),ctx=c.getContext("2d");let w,h;const draw=()=>{if(root.hidden||root.dataset.screen!=="play")return;w=c.width=c.clientWidth*devicePixelRatio;h=c.height=c.clientHeight*devicePixelRatio;ctx.clearRect(0,0,w,h);const time=performance.now()/1000;for(let i=0;i<64;i++){const x=(i+.5)*w/64,amp=(.12+Math.abs(Math.sin(time*2+i*.53))*.55)*h*.36;ctx.fillStyle="rgba(180,115,255,"+(.22+Math.abs(Math.sin(time+i))*.5)+")";ctx.fillRect(x,h/2-amp,Math.max(2,w/110),amp*2);}state.visual=requestAnimationFrame(draw);};draw();}
function bind(){
 $("#partyAiOpen").onclick=open;$("#paiClose").onclick=close;$("#paiRefresh").onclick=load;$("#paiSave").onclick=save;
 $("#paiStart").onclick=()=>{if(!state.tracks.length)return say("Upload your pre-mixed files first.");$("#paiPlayChoice").hidden=false;say("Choose Shuffle or play chronologically from Mix 01.");};
 $("#paiShuffleStart").onclick=()=>{if(!state.tracks.length)return;state.playOrder="shuffle";$("#paiPlayChoice").hidden=true;state.remaining=state.tracks.map((_,i)=>i);const first=Math.floor(Math.random()*state.remaining.length);state.index=state.remaining.splice(first,1)[0];playCurrent();animate();};
 $("#paiChronologicalStart").onclick=()=>{if(!state.tracks.length)return;state.playOrder="chronological";$("#paiPlayChoice").hidden=true;state.remaining=state.tracks.map((_,i)=>i);state.index=state.remaining.shift();playCurrent();animate();};
 $("#paiPause").onclick=()=>{music.pause();intro.pause();state.playing=false;$("#paiPlay").dataset.playing="false";updateSkipControls();};
 $("#paiResume").onclick=()=>{if(state.mode==="done"){state.remaining=state.tracks.map((_,i)=>i);if(state.playOrder==="chronological")state.index=state.remaining.shift();else{const first=Math.floor(Math.random()*state.remaining.length);state.index=state.remaining.splice(first,1)[0];}playCurrent();}else if(state.mode==="music"){music.play();state.playing=true;$("#paiPlay").dataset.playing="true";updateSkipControls();}else if(state.mode==="intro"){intro.play();state.playing=true;$("#paiPlay").dataset.playing="true";updateSkipControls();}else playCurrent();};
 $("#paiNext").onclick=()=>{music.pause();intro.pause();next();};
 $("#paiSkipBack45").onclick=()=>skipBy(-45);$("#paiSkipBack30").onclick=()=>skipBy(-30);$("#paiSkipBack15").onclick=()=>skipBy(-15);
 $("#paiSkip15").onclick=()=>skipBy(15);$("#paiSkip30").onclick=()=>skipBy(30);$("#paiSkip45").onclick=()=>skipBy(45);
 updateSkipControls();
 $("#paiBack").onclick=()=>{stop();};
 music.ontimeupdate=()=>{$("#paiProgress").style.width=(music.duration?music.currentTime/music.duration*100:0)+"%";$("#paiClock").textContent=fmt(music.currentTime)+" / "+fmt(music.duration);};
 music.onended=()=>{if(state.playing)next();};
}
document.addEventListener("DOMContentLoaded",()=>{bind();});
})();