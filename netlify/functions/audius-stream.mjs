// Resolves a playable stream URL for one Audius track id.
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9]{3,20}$/.test(id)) return json({ error: "Invalid track id." }, 400);
  const p = new URLSearchParams({ app_name: "VibeFlow" });
  if (process.env.AUDIUS_API_KEY) p.set("api_key", process.env.AUDIUS_API_KEY);
  try {
    const r = await fetch(`https://api.audius.co/v1/tracks/${id}/stream?${p}`, { redirect: "manual" });
    const url = r.headers.get("location");
    if (url) return json({ url });
    if (r.ok) return json({ url: r.url });
    return json({ error: "This track is not available for streaming." }, 404);
  } catch { return json({ error: "Could not reach Audius." }, 502); }
};
