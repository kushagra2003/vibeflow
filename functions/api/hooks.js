function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
const api=(path,token,init={})=>fetch("https://api.github.com"+path,{...init,headers:{"Accept":"application/vnd.github+json","User-Agent":"VIBE-FLOW-Cloudflare-Hooks","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json",...(init.headers||{})}});
const decode=b64=>Uint8Array.from(atob(b64.replace(/\n/g,"")),c=>c.charCodeAt(0));
const encode=value=>{const bytes=new TextEncoder().encode(value);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);};
function mergeHooks(...lists){const byId=new Map();for(const list of lists)for(const h of Array.isArray(list)?list:[]){const key=String(h.id||"");if(key)byId.set(key,h);else byId.set("legacy:"+Number(h.t)+":"+String(h.lyric||""),h);}return [...byId.values()].sort((a,b)=>Number(a.t)-Number(b.t));}
function mergePayloads(current,incoming){const map=new Map((current.songs||[]).filter(x=>x?.file).map(x=>[x.file,{...x}]));for(const song of incoming.songs||[]){if(!song?.file)continue;const old=map.get(song.file)||song;map.set(song.file,{...old,...song,hooks:mergeHooks(old.hooks,song.hooks)});}return {app:"VIBE FLOW",version:1,updatedAt:new Date().toISOString(),songs:[...map.values()].sort((a,b)=>a.file.localeCompare(b.file))};}
async function getFile(repo,branch,token){const r=await api("/repos/"+repo+"/contents/hooks.json?ref="+encodeURIComponent(branch),token);if(r.status===404)return {sha:null,payload:{app:"VIBE FLOW",version:1,songs:[]}};if(!r.ok)throw new Error("GitHub read failed: "+r.status+" "+await r.text());const f=await r.json();return {sha:f.sha,payload:JSON.parse(new TextDecoder().decode(decode(f.content)))};}
export async function onRequest(context){
 const {request,env}=context,token=env.GITHUB_TOKEN,repo=env.GITHUB_REPOSITORY||"kushagra2003/vibeflow",branch=env.GITHUB_BRANCH||"main";
 if(!token)return json({error:"GitHub backup is not configured. Add the GITHUB_TOKEN secret to Cloudflare Pages."},503);
 if(request.method==="GET"){
  try{const current=await getFile(repo,branch,token);return json(current.payload);}
  catch(error){return json({error:error.message},502);}
 }
 if(request.method==="PUT"){
  try{
   const incoming=await request.json();if(!Array.isArray(incoming.songs))return json({error:"Invalid hooks backup payload."},400);
   const current=await getFile(repo,branch,token),merged=mergePayloads(current.payload,incoming);
   const body={message:"Sync VIBE FLOW shared hooks",branch,content:encode(JSON.stringify(merged,null,2))};
   if(current.sha)body.sha=current.sha;
   const saved=await api("/repos/"+repo+"/contents/hooks.json",token,{method:"PUT",body:JSON.stringify(body)});
   if(!saved.ok)return json({error:"GitHub write failed: "+saved.status+" "+(await saved.text()).slice(0,500)},502);
   return json({ok:true,songs:merged.songs.length,sha:(await saved.json()).content?.sha||null});
  }catch(error){return json({error:error.message||"Hook sync failed."},502);}
 }
 return json({error:"Method not allowed"},405);
}
