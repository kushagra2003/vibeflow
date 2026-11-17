(() => {
  const panel = document.querySelector("#lyricsStudio");
  if (!panel) return;
  const $ = selector => panel.querySelector(selector);
  const picker = $("#lyricsTrackSelect");
  const status = $("#lyricsStatus");
  const result = $("#lyricsResult");
  const autoToggle = $("#lyricsAutoMode");
  const analysed = new Set();
  const attempted = new Set();
  const inFlight = new Set();
  const cache = new Map();
  let autoEnabled = false;

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };
  const parseTime = value => {
    if (value == null) return null;
    const raw = String(value).trim();
    if (/^\d+(\.\d+)?s$/.test(raw)) return Number(raw.slice(0,-1));
    const parts = raw.split(":");
    if (parts.length === 3) return +parts[0]*3600 + +parts[1]*60 + +parts[2];
    if (parts.length === 2) return +parts[0]*60 + +parts[1];
    const n=Number(raw); return Number.isFinite(n)?n:null;
  };
  function parseTtml(xml) {
    const doc=new DOMParser().parseFromString(xml||"","application/xml");
    if(doc.querySelector("parsererror")) return [];
    return [...doc.getElementsByTagNameNS("*","p")].map((p,i)=>{
      const spans=[...p.getElementsByTagNameNS("*","span")];
      const words=spans.map(s=>({text:(s.textContent||"").trim(),start:parseTime(s.getAttribute("begin")),end:parseTime(s.getAttribute("end"))})).filter(w=>w.text&&w.start!=null&&w.end!=null);
      const text=(p.textContent||"").replace(/\s+/g," ").trim();
      const start= parseTime(p.getAttribute("begin")) ?? words[0]?.start;
      const end= parseTime(p.getAttribute("end")) ?? words.at(-1)?.end;
      return {id:"l"+i,text,start,end,words};
    }).filter(x=>x.text&&x.start!=null&&x.end!=null);
  }
  function parseLrc(text) {
    const found=[];
    for(const raw of String(text||"").split(/\r?\n/)){
      const m=raw.match(/^\s*\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/);
      if(m){const start=parseTime(m[1]);if(start!=null)found.push({text:m[2].trim(),start});}
    }
    return found.map((x,i)=>({id:"l"+i,text:x.text,start:x.start,end:found[i+1]?.start??x.start+4,words:[]}));
  }
  async function getJson(url,headers={}) {
    const response=await fetch(url,{headers});
    if(!response.ok){const e=new Error("HTTP "+response.status);e.status=response.status;throw e;}
    return response.json();
  }
  async function retrieve(track) {
    const params=new URLSearchParams({s:track.title||"",a:track.artist||"",al:track.album||"",d:String(Math.round(track.duration||0))});
    try{
      const data=await getJson("https://api.betterlyrics.org/getLyrics?"+params);
      const lines=parseTtml(data.ttml);
      if(lines.length)return {provider:"Better Lyrics TTML",lines};
    }catch(e){if(![401,404,429].includes(e.status))console.debug("Better Lyrics:",e.message);}
    try{
      const data=await getJson("https://api.betterlyrics.org/kugou/getLyrics?"+params);
      const lines=parseLrc(data.lyrics);
      if(lines.length)return {provider:"Better Lyrics Kugou",lines};
    }catch(e){console.debug("Kugou lyrics:",e.message);}
    const headers={"X-User-Agent":"VIBE-FLOW/1.0 (https://github.com/kushagra2003/vibeflow)"};
    const query=new URLSearchParams({track_name:track.title||"",artist_name:track.artist||""});
    if(track.album)query.set("album_name",track.album);
    if(track.duration)query.set("duration",String(Math.round(track.duration)));
    let record;
    try{record=await getJson("https://lrclib.net/api/get?"+query,headers);}
    catch(e){
      if(e.status!==404)throw e;
      const search=new URLSearchParams({track_name:track.title||"",artist_name:track.artist||""});
      const matches=await getJson("https://lrclib.net/api/search?"+search,headers);
      record=matches.find(x=>x.syncedLyrics)||matches.find(x=>x.plainLyrics);
    }
    if(!record)return null;
    const lines=parseLrc(record.syncedLyrics);
    if(lines.length)return {provider:"LRCLIB synced lyrics",lines};
    if(record.plainLyrics)return {provider:"LRCLIB plain lyrics",lines:record.plainLyrics.split(/\r?\n/).filter(Boolean).map((text,i)=>({id:"l"+i,text,start:null,end:null,words:[]}))};
    return null;
  }
  function lyricHooks(lines) {
    const groups=new Map();
    for(const line of lines){
      if(line.start==null||!line.text)continue;
      const key=line.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
      if(key.length<5)continue;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(line);
    }
    const hooks=[];
    for(const occurrences of groups.values()){
      if(occurrences.length<2)continue;
      for(const line of occurrences){
        hooks.push({
          id:"lyric-"+Math.round(line.start*10),
          t:Math.max(0,Number(line.start)),
          end:Number(line.end)>Number(line.start)?Number(line.end):null,
          endSource:"lyrics",
          lyric:line.text,
          source:"lyrics",
          detector:"repeated-lyric",
          confidence:Math.min(.95,.55+occurrences.length*.08),
          generatedAt:Date.now()
        });
      }
    }
    return hooks.sort((a,b)=>a.t-b.t);
  }
  function getSnapshot(){
    return window.VibeFlowDJ?.getTracks?.() || {current:null,next:null,queue:[]};
  }
  function fillPicker(){
    const snapshot=getSnapshot();
    const selected=picker.value;
    const options=[
      {value:"current",label:snapshot.current?"Current · "+snapshot.current.title:"Current song"},
      {value:"next",label:snapshot.next?"Next · "+snapshot.next.title:"Next in queue"}
    ];
    for(const track of snapshot.queue||[]){
      options.push({value:"track:"+track.id,label:(track.isCurrent?"Playing · ":"Queue "+(track.queueIndex+1)+" · ")+(track.title||"Unknown")+" — "+(track.artist||"Unknown")});
    }
    picker.replaceChildren();
    for(const option of options){const el=document.createElement("option");el.value=option.value;el.textContent=option.label;picker.append(el);}
    if(options.some(o=>o.value===selected))picker.value=selected;
  }
  function resolveSelected(){
    const snapshot=getSnapshot(),value=picker.value;
    if(value==="current")return snapshot.current;
    if(value==="next")return snapshot.next;
    if(value.startsWith("track:"))return snapshot.queue.find(t=>t.id===value.slice(6))||null;
    return null;
  }
  function renderResult(track,data,hooks,audioSummary=null){
    result.replaceChildren();
    const heading=document.createElement("div");
    heading.className="lyrics-result-meta";
    heading.textContent=track.title+" · "+track.artist+" · "+data.provider+" · "+data.lines.length+" lines";
    result.append(heading);
    const cue=document.createElement("div");
    cue.className="lyrics-cue-summary";
    cue.textContent=hooks.length+" repeated-lyric cue points identified"+(hooks.length?" · attached to DJ hook memory":" · no repeated lyric sections found");
    result.append(cue);
    if(audioSummary){
      const metrics=document.createElement("div");metrics.className="lyrics-audio-metrics";
      metrics.textContent="BPM "+audioSummary.bpm+" · "+Math.round(audioSummary.bpmConfidence*100)+"% pulse confidence · intro "+audioSummary.introEnd.toFixed(1)+"s · outro "+audioSummary.outroStart.toFixed(1)+"s · phrase-aligned mix cues";
      result.append(metrics);
    }
    for(const line of data.lines.slice(0,80)){
      const row=document.createElement("div");row.className="lyric-preview-line";
      const stamp=document.createElement("time");stamp.textContent=line.start==null?"—":line.start.toFixed(2)+"s";
      const text=document.createElement("span");text.textContent=line.text;
      row.append(stamp,text);result.append(row);
    }
  }
  async function analyse(track,{silent=false}={}){
    if(!track){if(!silent)setStatus("There is no selected track yet. Start a song or add tracks to the queue.","warning");return;}
    if(inFlight.has(track.id)||attempted.has(track.id))return;
    attempted.add(track.id);
    if(cache.has(track.id)){const cached=cache.get(track.id);if(!silent){if(cached.data)renderResult(track,cached.data,cached.hooks,cached.audioSummary);else if(cached.audioSummary){result.replaceChildren();const metrics=document.createElement("div");metrics.className="lyrics-audio-metrics";metrics.textContent="Audio structure ready · BPM "+cached.audioSummary.bpm+" · intro "+cached.audioSummary.introEnd.toFixed(1)+"s · outro "+cached.audioSummary.outroStart.toFixed(1)+"s · no lyrics match.";result.append(metrics);}}return;}
    inFlight.add(track.id);
    if(!silent)setStatus("Finding timed lyrics for "+track.title+"…","busy");
    try{
      // Fetch catalogue lyrics first. Heavy waveform decoding must never delay
      // lyric availability or hold up the DJ queue's preparation flow.
      const data=await retrieve(track);
      let audioSummary=null;
      const audioAnalysisPromise=(async()=>{
        try {
          const audioResult=await window.VibeFlowDJ?.analyseAudio?.(track.id);
          return audioResult?.analysis||null;
        } catch(error) {
          console.info("Audio structure analysis unavailable for "+track.title+":",error.message);
          return null;
        }
      })();
      if(!data){
        if(audioSummary){
          cache.set(track.id,{data:null,hooks:[],audioSummary});
          analysed.add(track.id);
          if(!silent){
            result.replaceChildren();
            const metrics=document.createElement("div");metrics.className="lyrics-audio-metrics";
            metrics.textContent="Audio structure ready · BPM "+audioSummary.bpm+" · intro "+audioSummary.introEnd.toFixed(1)+"s · outro "+audioSummary.outroStart.toFixed(1)+"s · "+audioSummary.energyHooks.length+" audio cue candidates. No lyrics match was found.";
            result.append(metrics);
            setStatus("Audio analysis is ready for "+track.title+". Lyrics were not available from the connected catalogues.","success");
          }
        } else if(!silent)setStatus("No matching lyrics or audio analysis found for "+track.title+".","warning");
        return;
      }
      const hooks=lyricHooks(data.lines);
      cache.set(track.id,{data,hooks,audioSummary:null});
      // Continue audio analysis in the background; it is not a prerequisite for playback.
      audioAnalysisPromise.then(summary=>{
        if(!summary)return;
        const existing=cache.get(track.id);
        if(existing)cache.set(track.id,{...existing,audioSummary:summary});
        if(!silent && resolveSelected()?.id===track.id){
          const refreshed=cache.get(track.id);
          renderResult(track,refreshed.data,refreshed.hooks,summary);
        }
      });
      if(hooks.length)window.VibeFlowDJ?.applyLyricsHooks?.(track.id,hooks);
      analysed.add(track.id);
      if(!silent){renderResult(track,data,hooks,audioSummary);setStatus("Prepared "+track.title+". "+hooks.length+" repeated-lyric cue points are available to the DJ engine."+(audioSummary?" BPM "+audioSummary.bpm+" · phrase grid ready.":" Lyrics found; audio structure analysis was unavailable."),"success");}
    }catch(error){
      if(!silent)setStatus("Lyrics lookup failed ("+error.message+"). Try again later.","error");
    }finally{inFlight.delete(track.id);}
  }
  async function autoPrepare(){
    if(!autoEnabled)return;
    const snapshot=getSnapshot();
    const tracks=[snapshot.current,snapshot.next].filter(Boolean);
    for(const track of tracks){
      if(analysed.has(track.id)||inFlight.has(track.id))continue;
      await analyse(track,{silent:true});
    }
    if(tracks.length)setStatus("Auto mode ready · prepared "+tracks.map(t=>t.title).join(" and ")+".","success");
  }
  $("#lyricsAnalyseSelected").addEventListener("click",()=>analyse(resolveSelected()));
  autoToggle.addEventListener("change",()=>{
    autoEnabled=autoToggle.checked;
    try{localStorage.setItem("vf_lyrics_auto",autoEnabled?"1":"0");}catch{}
    if(autoEnabled){setStatus("Auto analysis enabled. Preparing current and next tracks…","busy");autoPrepare();}
    else setStatus("Auto analysis paused. You can still analyse any selected queue track.");
  });
  picker.addEventListener("change",()=>{const track=resolveSelected();if(track)setStatus("Selected "+track.title+". Click Analyse selected to prepare it.");});
  window.addEventListener("vibeflow:queue-updated",()=>{
    fillPicker();
    if(autoEnabled)autoPrepare();
  });
  try{autoEnabled=localStorage.getItem("vf_lyrics_auto")==="1";autoToggle.checked=autoEnabled;}catch{}
  fillPicker();
  if(autoEnabled)autoPrepare();
})();