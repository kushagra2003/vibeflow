// Cloudflare Pages Function: Audius search and trending tracks.
const HOST = "https://api.audius.co/v1";
const cache = new Map();
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "public, max-age=30" } });

export async function onRequest(context) {
  const { request, env } = context;
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
  const mode = u.searchParams.get("mode") === "trending" ? "trending" : "search";
  if (mode === "search" && q.length < 2) return json({ error: "Type at least 2 characters." }, 400);

  const key = mode + ":" + q;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 60000) return json(hit.v);

  const params = new URLSearchParams({ app_name: "VibeFlow", limit: "20" });
  if (env.AUDIUS_API_KEY) params.set("api_key", env.AUDIUS_API_KEY);
  if (mode === "search") params.set("query", q);

  try {
    const response = await fetch(`${HOST}/tracks/${mode}?${params}`);
    if (!response.ok) return json({ error: `Audius returned ${response.status}` }, 502);
    const data = (await response.json()).data || [];
    const tracks = data.filter(t => t.is_streamable !== false).map(t => ({
      id: t.id, title: t.title, artist: t.user?.name || "Unknown", provider: "audius",
      art: t.artwork?.["480x480"] || t.artwork?.["150x150"] || "",
      genre: t.genre || "", mood: t.mood || "", duration: t.duration || 0,
      link: t.permalink ? "https://audius.co" + t.permalink : ""
    }));
    const value = { tracks };
    cache.set(key, { t: Date.now(), v: value });
    return json(value);
  } catch {
    return json({ error: "Could not reach Audius." }, 502);
  }
}
