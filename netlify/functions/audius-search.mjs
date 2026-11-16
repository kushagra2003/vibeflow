// Searches Audius (or fetches trending) and returns normalised tracks. Real data only.
const HOST = "https://api.audius.co/v1";
const cache = new Map();
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

export default async (req) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
  const mode = u.searchParams.get("mode") === "trending" ? "trending" : "search";
  if (mode === "search" && q.length < 2) return json({ error: "Type at least 2 characters." }, 400);
  const key = mode + ":" + q;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 60000) return json(hit.v);
  const p = new URLSearchParams({ app_name: "VibeFlow", limit: "20" });
  if (process.env.AUDIUS_API_KEY) p.set("api_key", process.env.AUDIUS_API_KEY);
  if (mode === "search") p.set("query", q);
  try {
    const r = await fetch(`${HOST}/tracks/${mode}?${p}`);
    if (!r.ok) return json({ error: `Audius returned ${r.status}` }, 502);
    const d = (await r.json()).data || [];
    const tracks = d.filter(t => t.is_streamable !== false).map(t => ({
      id: t.id, title: t.title, artist: t.user?.name || "Unknown", provider: "audius",
      art: t.artwork?.["480x480"] || t.artwork?.["150x150"] || "", genre: t.genre || "", mood: t.mood || "",
      duration: t.duration || 0, link: t.permalink ? "https://audius.co" + t.permalink : ""
    }));
    const v = { tracks };
    cache.set(key, { t: Date.now(), v });
    return json(v);
  } catch (e) { return json({ error: "Could not reach Audius." }, 502); }
};
