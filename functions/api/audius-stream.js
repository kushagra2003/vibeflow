// Cloudflare Pages Function: resolve an Audius track ID into a playable stream URL.
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequest({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  // Audius track IDs are opaque numeric/alphanumeric identifiers.
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) {
    return json({ error: "Invalid Audius track ID." }, 400);
  }

  const params = new URLSearchParams({ app_name: "VibeFlow" });
  if (env.AUDIUS_API_KEY) params.set("api_key", env.AUDIUS_API_KEY);

  const endpoint = `https://api.audius.co/v1/tracks/${encodeURIComponent(id)}/stream?${params}`;

  try {
    // Audius normally responds with a redirect to the actual audio host.
    const upstream = await fetch(endpoint, { redirect: "manual" });
    const location = upstream.headers.get("location");

    if (location && upstream.status >= 300 && upstream.status < 400) {
      return json({ url: location });
    }

    // Some Audius nodes may follow/serve the stream directly.
    if (upstream.ok && upstream.url && upstream.url !== endpoint) {
      return json({ url: upstream.url });
    }

    const detail = await upstream.text().catch(() => "");
    return json({
      error: upstream.status === 404
        ? "Audius could not find a playable stream for this track."
        : `Audius stream request failed (${upstream.status}).`,
      detail: detail.slice(0, 180)
    }, upstream.status === 404 ? 404 : 502);
  } catch (error) {
    return json({ error: "Could not reach Audius stream service.", detail: String(error).slice(0, 180) }, 502);
  }
}
