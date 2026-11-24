function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}

export async function onRequestGet({request,env}){
  const key=env.YOUTUBE_API_KEY;
  if(!key)return json({error:"YouTube search is not configured yet. Add YOUTUBE_API_KEY as a Cloudflare Pages secret and redeploy."},503);
  const query=new URL(request.url).searchParams.get("q")?.trim().slice(0,120);
  if(!query)return json({error:"Enter a song name to search."},400);
  try{
    const url=new URL("https://www.googleapis.com/youtube/v3/search");
    url.search=new URLSearchParams({part:"snippet",type:"video",maxResults:"10",safeSearch:"moderate",q:query,key}).toString();
    const response=await fetch(url.toString());
    const payload=await response.json();
    if(!response.ok)return json({error:payload.error?.message||"YouTube search failed."},502);
    const results=(payload.items||[]).filter(item=>item.id?.videoId).map(item=>({
      videoId:item.id.videoId,
      title:item.snippet?.title||"Untitled video",
      channel:item.snippet?.channelTitle||"YouTube",
      thumbnail:item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||""
    }));
    return json({results,query});
  }catch(error){return json({error:error.message||"YouTube search is unavailable."},502);}
}
