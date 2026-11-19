export async function onRequestGet({ env }) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VIBE-FLOW-Library"
  };
  if (env.GITHUB_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  const upstream = await fetch("https://api.github.com/repos/kushagra2003/vibeflow/contents/songs?ref=main", {
    headers, cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!upstream.ok) {
    return Response.json({ error: "GitHub library request failed", status: upstream.status }, {
      status: 502, headers: { "Cache-Control": "no-store" }
    });
  }
  const files = await upstream.json();
  if (!Array.isArray(files)) {
    return Response.json({ error: "GitHub did not return a songs folder listing" }, { status: 502 });
  }
  const songs = files.filter(file =>
    file.type === "file" && /\\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)
  ).map(file => {
    const base = file.name.replace(/\\.[^.]+$/, "");
    const parts = base.split(" - ");
    return {
      file: file.name,
      title: parts.length > 1 ? parts.slice(1).join(" - ").trim() : base.replace(/[_-]+/g, " ").trim(),
      artist: parts.length > 1 ? parts[0].trim() : "Unknown",
      size: file.size,
      url: "songs/" + encodeURIComponent(file.name)
    };
  });
  return Response.json({ songs, count: songs.length, source: "github", updatedAt: new Date().toISOString() }, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" }
  });
}
