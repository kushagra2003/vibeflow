// Cloudflare Pages Function: AI ranks real tracks supplied by the VibeFlow client.
const json = (body, status = 200) => Response.json(body, { status });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const key = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!key) return json({ error: "AI_API_KEY is not configured in Cloudflare Pages." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  const current = body.current;
  const recent = (body.recent || []).slice(0, 10);
  const candidates = (body.candidates || []).slice(0, 30);
  if (!current?.id || !candidates.length) return json({ error: "A current track and candidates are required." }, 400);

  const slim = t => ({ id: t.id, title: t.title, artist: t.artist, genre: t.genre, mood: t.mood });
  const prompt = `You are a DJ. Current track: ${JSON.stringify(slim(current))}. Recently played ids: ${JSON.stringify(recent.map(t => t.id))}. User likes: ${JSON.stringify((body.likes || []).slice(0, 10))}.
Candidates: ${JSON.stringify(candidates.map(slim))}.
Choose up to 3 next tracks from candidates only, excluding recently played tracks. Do not invent BPM or lyrics. Return only JSON: {"recommendations":[{"id":"","score":0,"reason":"","transition":"Similar genre"}]}`;

  const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: env.AI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!response.ok) return json({ error: `AI provider returned ${response.status}.` }, 502);
    const raw = (await response.json()).choices?.[0]?.message?.content || "";
    const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    const byId = new Map(candidates.map(track => [String(track.id), track]));
    const recommendations = (parsed.recommendations || [])
      .filter(item => byId.has(String(item.id))).slice(0, 3)
      .map(item => ({
        ...byId.get(String(item.id)),
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        reason: String(item.reason || ""),
        transition: String(item.transition || "")
      }));
    return json({ recommendations });
  } catch {
    return json({ error: "AI recommendation request failed." }, 502);
  }
}
