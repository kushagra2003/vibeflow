// VibeFlow deployment health check.
export async function onRequest({ env }) {
  let audius = "unavailable";
  try {
    const r = await fetch("https://api.audius.co/v1/tracks/trending?limit=1&app_name=VibeFlow");
    audius = r.ok ? "ok" : `HTTP ${r.status}`;
  } catch {}
  return Response.json({
    functions: "ok",
    audius,
    audiusApiKeyConfigured: Boolean(env.AUDIUS_API_KEY),
    aiKeyConfigured: Boolean(env.AI_API_KEY || env.OPENAI_API_KEY)
  });
}
