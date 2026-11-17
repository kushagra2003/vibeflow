const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.LYRICS_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const base = process.env.VIBE_LYRICS_API_URL;
  if (!base) {
    return Response.json(
      { error: "VIBE_LYRICS_API_URL is not configured. Deploy the vibe-lyrics Python service first." },
      { status: 503, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "health";
  if (!["health", "v1/transcribe"].includes(path)) {
    return Response.json({ error: "Unsupported lyrics endpoint" }, { status: 404, headers: corsHeaders });
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const token = process.env.VIBE_LYRICS_API_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const upstream = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    return Response.json(
      { error: "Could not reach VIBE LYRICS service", detail: error.message },
      { status: 502, headers: corsHeaders }
    );
  }
};
