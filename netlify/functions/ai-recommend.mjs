// The AI only RANKS real Audius tracks the app sends in "candidates"; it never invents songs.
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const hits = new Map();
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const ip = req.headers.get("x-nf-client-connection-ip") || "x";
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (h.length >= 15) return json({ error: "Too many requests. Wait a minute." }, 429);
  hits.set(ip, [...h, now]);
  const KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!KEY) return json({ error: "AI_API_KEY is not set." }, 500);
  if (!process.env.AI_MODEL && process.env.AI_BASE_URL) return json({ error: "AI_MODEL is not set." }, 500);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const cur = b.current, recent = (b.recent || []).slice(0, 10), cands = (b.candidates || []).slice(0, 30);
  if (!cur?.id || !cands.length) return json({ error: "Need a current track and candidates." }, 400);
  const slim = t => ({ id: t.id, title: t.title, artist: t.artist, genre: t.genre, mood: t.mood });
  const prompt = `You are a DJ. Current track: ${JSON.stringify(slim(cur))}. Recently played ids: ${JSON.stringify(recent.map(t => t.id))}. User likes (favourite artists/genres): ${JSON.stringify((b.likes || []).slice(0, 10))}.
Candidates: ${JSON.stringify(cands.map(slim))}.
Pick the best 3 NEXT tracks from candidates only (not recently played). Use only the metadata given; do not guess BPM or lyrics. Reply with ONLY a JSON object, no other text: {"recommendations":[{"id":"","score":0-100,"reason":"","transition":"one of: Similar genre | Emotional continuity | Energy increase | Energy decrease | Related musical style | Similar lyrical theme"}]}`;
  try {
    const r = await fetch((process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
    });
    if (!r.ok) return json({ error: `AI provider returned ${r.status}` }, 502);
    const txt = (await r.json()).choices?.[0]?.message?.content || "";
    const out = JSON.parse((txt.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    const byId = new Map(cands.map(t => [String(t.id), t]));
    const recommendations = (out.recommendations || []).filter(x => byId.has(String(x.id))).slice(0, 3)
      .map(x => ({ ...byId.get(String(x.id)), score: Math.max(0, Math.min(100, +x.score || 0)), reason: String(x.reason || ""), transition: String(x.transition || "") }));
    return json({ recommendations });
  } catch { return json({ error: "AI request failed." }, 502); }
};
