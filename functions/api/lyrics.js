const allowedPaths = new Set(["health", "v1/transcribe"]);

function jsonError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
      },
    });
  }

  const path = url.searchParams.get("path") || "health";
  if (!allowedPaths.has(path)) return jsonError("Unsupported lyrics endpoint", 404);

  const base = env.VIBE_LYRICS_API_URL;
  if (!base) {
    return jsonError(
      "VIBE_LYRICS_API_URL is not configured. Deploy the Python lyrics service and set the Cloudflare Pages environment variables.",
      503,
    );
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  if (env.VIBE_LYRICS_API_TOKEN) {
    headers.set("Authorization", `Bearer ${env.VIBE_LYRICS_API_TOKEN}`);
  }

  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    return jsonError(
      `Could not reach VIBE LYRICS service: ${error instanceof Error ? error.message : "upstream error"}`,
      502,
    );
  }
}
