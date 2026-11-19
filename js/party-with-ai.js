(()=>{"use strict";
const $=s=>document.querySelector(s),root=$("#partyAi"),state={tracks:[],index:0,playing:false,mode:"idle",fade:null,visual:null,drag:null,volume:.9,manifestSaved:false};
const music=new Audio(),intro=new Audio(),scratch=new Audio();music.preload=intro.preload=scratch.preload="auto";music.volume=.9;intro.volume=.9;scratch.volume=.9;
let introContext=null,introGain=null;
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
function setScreen(screen){root.dataset.screen=screen;$("#paiManage").hidden=screen!=="manage";$("#paiPlay").hidden=screen==="manage";$("#paiPlay").dataset.playing=String(state.playing);}
function open(){root.hidden=false;document.body.classList.add("party-ai-open");load().then(()=>{mergeLocal();render();});}
function close(){stop();root.hidden=true;document.body.classList.remove("party-ai-open");}
function fadeAudio(a,to,duration=850){return new Promise(resolve=>{clearInterval(a._fade);const from=a.volume,start=performance.now();a._fade=setInterval(()=>{const p=Math.min(1,(performance.now()-start)/duration),e=p*p*(3-2*p);a.volume=from+(to-from)*e;if(p>=1){clearInterval(a._fade);a._fade=null;resolve();}},20);});}
async function prepareIntro(){try{if(!introContext){const C=window.AudioContext||window.webkitAudioContext;if(C){introContext=new C();const source=introContext.createMediaElementSource(intro);introGain=introContext.createGain();const compressor=introContext.createDynamicsCompressor();compressor.threshold.value=-20;compressor.knee.value=18;compressor.ratio.value=3;compressor.attack.value=.008;compressor.release.value=.22;source.connect(compressor).connect(introGain).connect(introContext.destination);}}if(introContext?.state==="suspended")await introContext.resume();}catch(e){console.warn("Intro loudness processor unavailable",e);}}
async function playCurrent(){
 clearTimeout(state.timer);
 const t=track();if(!t)return finish();
 state.playing=true;setScreen("play");$("#paiNowTitle").textContent=t.title;$("#paiComment").textContent=t.comment||"";$("#paiComment").classList.toggle("has-copy",!!t.comment);
 music.pause();intro.pause();music.src=t.file;music.currentTime=0;music.volume=0;
 if(t.intro){try{await prepareIntro();intro.src=t.intro;intro.currentTime=0;intro.volume=.9;await intro.play();state.mode="intro";$("#paiPhase").textContent="DJ INTRO";$("#paiComment").classList.toggle("visible",!!t.comment);say("Introducing "+t.title);intro.onended=()=>{if(state.playing)startMusic();};}catch(e){console.warn("Intro playback failed",e);state.timer=setTimeout(()=>{if(state.playing)startMusic();},2000);}}
 else{state.mode="pause";$("#paiPhase").textContent="NEXT MIX";$("#paiComment").classList.remove("visible");say("No intro found for "+t.title+" · starting in 2 seconds");setTimeout(()=>{if(state.playing)startMusic();},2000);}
}
async function startMusic(){if(!state.playing)return;intro.pause();state.mode="music";$("#paiPhase").textContent="NOW PLAYING";$("#paiComment").classList.remove("visible");try{music.currentTime=0;music.volume=0;await music.play();await fadeAudio(music,state.volume,1100);say("Playing "+track().title);}catch(e){say("Could not play this mix: "+e.message);next();}}
function next(){if(state.index<state.tracks.length-1){state.index++;playCurrent();}else finish();}
function finish(){state.playing=false;state.mode="done";music.pause();intro.pause();setScreen("done");$("#paiPhase").textContent="SESSION COMPLETE";$("#paiNowTitle").textContent="That’s a wrap.";$("#paiComment").textContent="Your party set has finished.";$("#paiComment").classList.add("visible");say("All party mixes played.");}
function stop(){clearTimeout(state.timer);state.playing=false;music.pause();intro.pause();scratch.pause();clearInterval(music._fade);clearInterval(intro._fade);if(state.visual)cancelAnimationFrame(state.visual);state.visual=null;setScreen("manage");}
function skip(seconds){if(!state.playing||state.mode!=="music")return;const target=music.currentTime+seconds;if(target>=music.duration){scratchPlay(()=>next());return;}scratchPlay(async()=>{await fadeAudio(music,0,180);music.currentTime=target;await fadeAudio(music,state.volume,550);});}
function scratchPlay(done){if(!state.effect){done?.();return;}scratch.src=state.effect;scratch.currentTime=0;scratch.volume=.95;$("#paiDisc").classList.add("scratching");scratch.onended=()=>{$("#paiDisc").classList.remove("scratching");done?.();};scratch.play().catch(()=>{ $("#paiDisc").classList.remove("scratching");done?.();});}
function animate(){const c=$("#paiViz"),ctx=c.getContext("2d");let w,h;const draw=()=>{if(root.hidden||root.dataset.screen!=="play")return;w=c.width=c.clientWidth*devicePixelRatio;h=c.height=c.clientHeight*devicePixelRatio;ctx.clearRect(0,0,w,h);const time=performance.now()/1000;for(let i=0;i<64;i++){const x=(i+.5)*w/64,amp=(.12+Math.abs(Math.sin(time*2+i*.53))*.55)*h*.36;ctx.fillStyle="rgba(180,115,255,"+(.22+Math.abs(Math.sin(time+i))*.5)+")";ctx.fillRect(x,h/2-amp,Math.max(2,w/110),amp*2);}state.visual=requestAnimationFrame(draw);};draw();}
function bind(){
 $("#partyAiOpen").onclick=open;$("#paiClose").onclick=close;$("#paiRefresh").onclick=load;$("#paiSave").onclick=save;
 $("#paiStart").onclick=()=>{if(!state.tracks.length)return say("Upload your pre-mixed files first.");state.index=0;playCurrent();animate();};
 $("#paiPause").onclick=()=>{music.pause();intro.pause();state.playing=false;$("#paiPlay").dataset.playing="false";};
 $("#paiResume").onclick=()=>{if(state.mode==="done"){state.index=0;playCurrent();}else if(state.mode==="music"){music.play();state.playing=true;$("#paiPlay").dataset.playing="true";}else if(state.mode==="intro"){intro.play();state.playing=true;$("#paiPlay").dataset.playing="true";}else playCurrent();};
 $("#paiNext").onclick=()=>{music.pause();intro.pause();next();};
 $("#paiSkip15").onclick=()=>skip(15);$("#paiSkip30").onclick=()=>skip(30);$("#paiSkip45").onclick=()=>skip(45);
 $("#paiBack").onclick=()=>{stop();};
 music.ontimeupdate=()=>{$("#paiProgress").style.width=(music.duration?music.currentTime/music.duration*100:0)+"%";$("#paiClock").textContent=fmt(music.currentTime)+" / "+fmt(music.duration);};
 music.onended=()=>{if(state.playing)next();};
}
document.addEventListener("DOMContentLoaded",()=>{bind();});
})();