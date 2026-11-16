// Cloudflare Pages Function: resolve an Audius track ID into a browser-playable stream URL.
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" }
});

export async function onRequest({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) {
    return json({ error: "Invalid Audius track ID." }, 400);
  }

  const params = new URLSearchParams({ app_name: "VibeFlow" });
  if (env.AUDIUS_API_KEY) params.set("api_key", env.AUDIUS_API_KEY);

  const endpoint = `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?${params}`;

  try {
    // Follow Audius' redirect to the actual audio CDN. Return the final CDN URL
    // so the browser's <audio> element can request the stream and seek normally.
    const upstream = await fetch(endpoint, { redirect: "follow" });

    if (!upstream.ok) {
      return json({
        error: `Audius stream request failed (${upstream.status}).`,
        detail: upstream.status === 404
          ? "This track may be unavailable for streaming."
          : "Audius could not resolve a playable stream."
      }, upstream.status === 404 ? 404 : 502);
    }

    const streamUrl = upstream.url;
    if (!streamUrl || streamUrl === endpoint) {
      return json({ error: "Audius did not return a playable stream URL." }, 502);
    }

    return json({ url: streamUrl });
  } catch (error) {
    return json({
      error: "Could not reach Audius stream service.",
      detail: String(error).slice(0, 160)
    }, 502);
  }
}
