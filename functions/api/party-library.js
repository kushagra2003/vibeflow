const REPO="kushagra2003/vibeflow",BRANCH="main";
const GH="https://api.github.com/repos/"+REPO;
const headers=token=>({"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"VIBE-FLOW-Party-AI",...(token?{Authorization:"Bearer "+token}:{})});
const supported=new Set(["mp3","wav","m4a","ogg","flac","aac"]);
async function listing(folder,token){
 const r=await fetch(GH+"/contents/"+folder+"?ref="+BRANCH,{headers:headers(token),cf:{cacheTtl:60}});
 if(r.status===404)return [];
 if(!r.ok)throw new Error("GitHub folder read failed: "+folder+" ("+r.status+")");
 const data=await r.json();
 return Array.isArray(data)?data.filter(x=>x.type==="file"&&supported.has((x.name.split(".").pop()||"").toLowerCase())):[];
}
async function manifest(token){
 const r=await fetch(GH+"/contents/party-data/playlist.json?ref="+BRANCH,{headers:headers(token)});
 if(r.status===404)return {version:1,tracks:[]};
 if(!r.ok)throw new Error("Playlist metadata could not be read ("+r.status+")");
 const file=await r.json(),raw=atob(file.content.replace(/\n/g,"")),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function onRequestGet({env}){
 try{
  const token=env.GITHUB_TOKEN||"";
  const [mixes,intros,effects,data]=await Promise.all([listing("party-mixes",token),listing("party-intros",token),listing("party-effects",token),manifest(token)]);
  const byId=new Map((data.tracks||[]).map(x=>[String(x.id),x]));
  const tracks=mixes.map(file=>{
   const id=file.name.replace(/\.[^.]+$/,"").toLowerCase(),saved=byId.get(id)||{};
   const intro=intros.find(x=>x.name.replace(/\.[^.]+$/,"").toLowerCase()===id);
   return {id,title:"Party Mix "+id.match(/\d+/)?.[0]?.padStart(2,"0")||id,file:"party-mixes/"+encodeURIComponent(file.name),intro:intro?"party-intros/"+encodeURIComponent(intro.name):null,comment:String(saved.comment||""),bpm:Number(saved.bpm)||null,order:Number.isFinite(Number(saved.order))?Number(saved.order):9999};
  }).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  return Response.json({tracks,effect:effects.find(x=>x.name.toLowerCase().startsWith("dj-scratch"))?.name?"party-effects/"+encodeURIComponent(effects.find(x=>x.name.toLowerCase().startsWith("dj-scratch")).name):null,persistAvailable:!!token},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({error:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
export async function onRequestPost({request,env}){
 if(!env.GITHUB_TOKEN)return Response.json({error:"Cloudflare GITHUB_TOKEN secret is required to save playlist comments to GitHub. Changes remain in this browser until configured."},{status:503});
 let body;try{body=await request.json();}catch{return Response.json({error:"Invalid JSON body"},{status:400});}
 if(!Array.isArray(body.tracks)||body.tracks.length>200)return Response.json({error:"Invalid playlist"},{status:400});
 const tracks=[];
 for(const t of body.tracks){
  if(!t||typeof t.id!=="string"||!/^[a-z0-9_-]{1,80}$/.test(t.id))return Response.json({error:"Invalid track ID"},{status:400});
  tracks.push({id:t.id,comment:String(t.comment||"").slice(0,240),bpm:Number.isFinite(Number(t.bpm))&&Number(t.bpm)>0?Number(t.bpm):null,order:Number.isFinite(Number(t.order))?Number(t.order):9999});
 }
 const token=env.GITHUB_TOKEN,branch=env.GITHUB_BRANCH||"main",url=GH+"/contents/party-data/playlist.json";
 const h={...headers(token),"Content-Type":"application/json"};
 try{
  const old=await fetch(url+"?ref="+encodeURIComponent(branch),{headers:h});
  let sha=null;
  if(old.ok)sha=(await old.json()).sha;else if(old.status!==404)throw new Error("Could not read existing playlist metadata ("+old.status+")");
  const content=JSON.stringify({version:1,updatedAt:new Date().toISOString(),tracks},null,2);
  const bytes=new TextEncoder().encode(content);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const put=await fetch(url,{method:"PUT",headers:h,body:JSON.stringify({message:"Update Party with AI playlist metadata",content:btoa(binary),branch,...(sha?{sha}:{})})});
  if(!put.ok)throw new Error("GitHub save failed ("+put.status+"): "+(await put.text()).slice(0,300));
  return Response.json({ok:true,saved:true});
 }catch(e){return Response.json({error:e.message},{status:502});}
}