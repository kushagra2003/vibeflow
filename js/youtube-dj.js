(()=>{"use strict";
const $=s=>document.querySelector(s);
const state={results:[],index:0,player:null,apiPromise:null,searching:false,playing:false,progressTimer:null,searchToken:0};
const status=(message)=>{const el=$("#paiYtStatus");if(el)el.textContent=message;};
const phase=(message)=>{const el=$("#paiPhase");if(el)el.textContent=message;};
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function ensureUI(){
 const stage=$("#paiShow .pai-stage-main");if(!stage||$("#paiPromptDeck"))return;
 const anchor=stage.querySelector(".pai-stage-subtitle");
 const panel=document.createElement("section");panel.id="paiPromptDeck";panel.className="pai-prompt-deck";
 panel.innerHTML=`
 <div class="pai-prompt-head"><div><span class="pai-prompt-kicker">NEW · PROMPT TO DECK</span><h3>Tell the DJ what to play.</h3><p>Search YouTube, audition a result, then let the room decide.</p></div><span class="pai-prompt-live">● YOUTUBE SOURCE</span></div>
 <form id="paiYtForm" class="pai-prompt-form"><input id="paiYtQuery" type="search" maxlength="120" autocomplete="off" placeholder="Song name · artist · remix…" aria-label="Search YouTube for a song" required><button id="paiYtSearch" type="submit">SEARCH & MIX ↗</button></form>
 <div class="pai-prompt-work" id="paiYtWork" hidden><div class="pai-prompt-workline"><span class="pai-prompt-spinner"></span><b id="paiYtStatus" role="status">Searching the crates…</b></div><div class="pai-prompt-progress"><i id="paiYtProgress"></i></div></div>
 <div class="pai-youtube-result" id="paiYtResult" hidden>
  <div class="pai-youtube-player-wrap"><div class="pai-youtube-label">SOURCE DECK · YOUTUBE</div><div id="paiYoutubePlayer" class="pai-youtube-player"></div></div>
  <div class="pai-youtube-meta"><small id="paiYtCounter">RESULT 01</small><b id="paiYtTitle">Ready</b><span id="paiYtChannel"></span>
   <div class="pai-youtube-controls"><button type="button" id="paiYtPlay">Ⅱ PAUSE</button><button type="button" id="paiYtBack">↶ 15s</button><button type="button" id="paiYtForward">15s ↷</button><button type="button" id="paiYtAgain" class="pai-youtube-again">↻ MIX AGAIN</button></div>
   <div class="pai-youtube-note">Compact YouTube player · playback may require one tap if your browser blocks autoplay.</div>
  </div>
 </div>
 <div class="pai-prompt-foot">SEARCH RESULTS ARE RANDOMIZED ONCE · MIX AGAIN LOADS THE NEXT RESULT</div>`;
 anchor?.insertAdjacentElement("afterend",panel);
 $("#paiYtForm").addEventListener("submit",search);
 $("#paiYtAgain").addEventListener("click",()=>playResult(state.index+1));
 $("#paiYtPlay").addEventListener("click",togglePlayback);
 $("#paiYtBack").addEventListener("click",()=>seek(-15));
 $("#paiYtForward").addEventListener("click",()=>seek(15));
}
function loadApi(){
 if(state.apiPromise)return state.apiPromise;
 state.apiPromise=new Promise((resolve,reject)=>{
  if(window.YT?.Player){resolve(window.YT);return;}
  const previous=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{try{previous?.();}catch{}resolve(window.YT);};
  const script=document.createElement("script");script.src="https://www.youtube.com/iframe_api";script.async=true;
  script.onerror=()=>reject(new Error("Could not load the YouTube player API."));
  document.head.appendChild(script);
 });
 return state.apiPromise;
}
async function ensurePlayer(){
 const YT=await loadApi();
 if(state.player)return state.player;
 return new Promise((resolve,reject)=>{
  try{
   state.player=new YT.Player("paiYoutubePlayer",{width:"200",height:"200",videoId:"",playerVars:{autoplay:0,controls:0,playsinline:1,rel:0,iv_load_policy:3,modestbranding:1},events:{
    onReady:()=>resolve(state.player),
    onStateChange:event=>{state.playing=event.data===YT.PlayerState.PLAYING;const button=$("#paiYtPlay");if(button)button.textContent=state.playing?"Ⅱ PAUSE":"▶ PLAY";},
    onAutoplayBlocked:()=>{status("Browser paused autoplay. Tap PLAY to start the selected track.");const button=$("#paiYtPlay");if(button)button.textContent="▶ PLAY";},
    onError:event=>status("YouTube could not play this result (code "+event.data+"). Try MIX AGAIN.")
   }});
  }catch(error){reject(error);}
 });
}
async function search(event){
 event?.preventDefault();
 const query=$("#paiYtQuery")?.value.trim();if(!query||state.searching)return;
 const token=++state.searchToken;state.searching=true;
 $("#paiYtSearch").disabled=true;$("#paiYtWork").hidden=false;$("#paiYtResult").hidden=true;
 status("Searching YouTube for "+query+"…");$("#paiYtProgress").style.width="8%";
 try{
  const response=await fetch("/api/youtube-search?q="+encodeURIComponent(query));
  const payload=await response.json();if(!response.ok)throw new Error(payload.error||"YouTube search failed.");
  if(token!==state.searchToken)return;
  if(!payload.results?.length)throw new Error("No playable YouTube results found. Try adding the artist name.");
  state.results=payload.results.slice();
  for(let i=state.results.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.results[i],state.results[j]]=[state.results[j],state.results[i]];}
  state.index=0;
  await ensurePlayer();
  const messages=["Downloading the set list…","Matching tempo and checking the groove…","Lining up the intro…","Adding the beat grid…","Final checks — almost ready…"];
  for(let i=0;i<messages.length;i++){
   if(token!==state.searchToken)return;
   status(messages[i]);$("#paiYtProgress").style.width=((i+1)/messages.length*100)+"%";
   await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(token!==state.searchToken)return;
  $("#paiYtWork").hidden=true;$("#paiYtResult").hidden=false;
  await playResult(0,true);
 }catch(error){
  if(token===state.searchToken){$("#paiYtWork").hidden=true;status(error.message);$("#paiYtStatus").textContent=error.message;$("#paiYtWork").hidden=false;}
 }finally{if(token===state.searchToken){state.searching=false;$("#paiYtSearch").disabled=false;}}
}
async function playResult(index,first=false){
 if(!state.results.length)return;
 if(index>=state.results.length){status("That crate is empty. Search again for a fresh set.");return;}
 state.index=index;const result=state.results[index];
 $("#paiYtCounter").textContent="RESULT "+String(index+1).padStart(2,"0")+" / "+String(state.results.length).padStart(2,"0");
 $("#paiYtTitle").textContent=result.title;$("#paiYtChannel").textContent=result.channel;
 $("#paiYtAgain").disabled=index>=state.results.length-1;
 $("#paiYtResult").hidden=false;phase("YOUTUBE DECK · "+(first?"SET LOADED":"MIX RELOADED"));
 status("Loading "+result.title+"…");
 try{
  const player=await ensurePlayer();
  player.loadVideoById({videoId:result.videoId,startSeconds:0});
  status("Now playing · "+result.title);
  startProgress();
 }catch(error){status(error.message);}
}
function startProgress(){
 clearInterval(state.progressTimer);
 state.progressTimer=setInterval(()=>{
  if(!state.player||!state.playing)return;
  const current=state.player.getCurrentTime?.()||0,duration=state.player.getDuration?.()||0;
  const progress=$("#paiProgress"),clock=$("#paiClock");
  if(progress&&duration)progress.style.width=(current/duration*100)+"%";
  if(clock&&duration){const f=n=>Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");clock.textContent=f(current)+" / "+f(duration);}
 },500);
}
function togglePlayback(){
 if(!state.player)return;
 const YT=window.YT;
 if(state.playing)state.player.pauseVideo();else state.player.playVideo();
}
function seek(offset){
 if(!state.player)return;
 const duration=state.player.getDuration?.()||Infinity,current=state.player.getCurrentTime?.()||0;
 state.player.seekTo(Math.max(0,Math.min(duration,current+offset)),true);
 status(offset<0?"Scrubbed back 15 seconds.":"Skipped forward 15 seconds.");
}
document.addEventListener("DOMContentLoaded",ensureUI);
})();