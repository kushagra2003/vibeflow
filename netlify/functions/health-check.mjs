export default async () => {
  let audius = "down";
  try { audius = (await fetch("https://api.audius.co/v1/tracks/trending?limit=1&app_name=VibeFlow")).ok ? "ok" : "down"; } catch {}
  return new Response(JSON.stringify({ functions: "ok", aiKeySet: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY), aiBaseUrl: process.env.AI_BASE_URL || 'openai default', aiModel: process.env.AI_MODEL || 'not set', audiusKeySet: !!process.env.AUDIUS_API_KEY, audius }),
    { headers: { "content-type": "application/json" } });
};
