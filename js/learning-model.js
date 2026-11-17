// VIBE FLOW local feedback-trained timing model. No network or external AI service.
(() => {
  const KEY="vf_training_model";
  const empty=()=>({version:1,score:0,transitions:0,outgoing:{},incoming:{},history:[]});
  const read=()=>{try{return {...empty(),...(JSON.parse(localStorage.getItem(KEY))||{})};}catch{return empty();}};
  const write=data=>{try{localStorage.setItem(KEY,JSON.stringify(data));}catch{}}
  const key=(track,hook)=>String(track?.id||"")+"::"+String(hook?.id??hook?.hookId??hook?.t??"");
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const getOffset=(track,hook,side)=>{const m=read(),entry=(m[side]||{})[key(track,hook)];return clamp(Number(entry?.offset)||0,-3,3);};
  const stats=()=>{const m=read();const mean=o=>{const v=Object.values(o||{});return v.length?Math.round(v.reduce((s,x)=>s+(x.count||0),0)/v.length):0;};return {score:m.score||0,transitions:m.transitions||0,outgoingCount:Object.values(m.outgoing||{}).reduce((s,x)=>s+(x.count||0),0),incomingCount:Object.values(m.incoming||{}).reduce((s,x)=>s+(x.count||0),0),outgoingAccuracy:mean(m.outgoing),incomingAccuracy:mean(m.incoming),history:m.history||[]};};
  const record=(fromTrack,fromHook,toTrack,toHook,outRating,inRating)=>{
    const m=read(), ratings=[outRating,inRating];
    const apply=(side,track,hook,rating)=>{if(!track||!hook||!rating)return;const k=key(track,hook),bucket=m[side]||(m[side]={}),entry=bucket[k]||(bucket[k]={offset:0,score:0,count:0,perfect:0});entry.offset=clamp(entry.offset+rating.adjust,-3,3);entry.score+=rating.score;entry.count++;if(rating.score===2)entry.perfect++;};
    apply("outgoing",fromTrack,fromHook,outRating);apply("incoming",toTrack,toHook,inRating);
    m.score=(m.score||0)+ratings.reduce((s,x)=>s+(x?.score||0),0);m.transitions=(m.transitions||0)+1;
    m.history=m.history||[];m.history.unshift({at:Date.now(),from:fromTrack?.title||"",to:toTrack?.title||"",outScore:outRating?.score||0,inScore:inRating?.score||0,total:ratings.reduce((s,x)=>s+(x?.score||0),0)});m.history=m.history.slice(0,300);write(m);return stats();
  };
  window.VibeLearningModel={getOffset,record,stats};
})();