// Cloudflare Pages Function: transcribe a library track and return timestamped lyric segments.
// The client reviews candidates and explicitly approves them; this endpoint never writes to saved hooks.
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const key = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!key) return json({ error: "AI_API_KEY is not configured in Cloudflare Pages. Add it to your Pages environment variables and redeploy." }, 503);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Upload a supported audio file to scan." }, 400); }
  const audio = form.get("audio");
  if (!audio || typeof audio.arrayBuffer !== "function") return json({ error: "Audio file is missing." }, 400);
  if (audio.size <= 0) return json({ error: "Audio file is empty." }, 400);
  if (audio.size > 24 * 1024 * 1024) return json({ error: "Audio files must be 24 MB or smaller." }, 413);
  const allowed = new Set(["audio/mpeg","audio/mp3","audio/mp4","audio/x-m4a","audio/m4a","audio/wav","audio/x-wav","audio/ogg","audio/webm","audio/aac","audio/flac","application/octet-stream"]);
  if (audio.type && !allowed.has(audio.type)) return json({ error: "Unsupported audio format. Try MP3, WAV, M4A, OGG or FLAC." }, 415);
  const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const upstreamForm = new FormData();
  upstreamForm.append("file", audio, audio.name || "track.mp3");
  upstreamForm.append("model", env.HOOK_TRANSCRIPTION_MODEL || "whisper-1");
  upstreamForm.append("response_format", "verbose_json");
  upstreamForm.append("timestamp_granularities[]", "segment");
  try {
    const upstream = await fetch(base + "/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: upstreamForm });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) { const detail = payload.error?.message || payload.message || ("Transcription provider returned " + upstream.status + "."); return json({ error: String(detail).slice(0, 300) }, 502); }
    const segments = Array.isArray(payload.segments) ? payload.segments.filter(s => Number.isFinite(Number(s.start)) && typeof s.text === "string").map(s => ({ start: Number(s.start), end: Number(s.end) || null, text: s.text.slice(0, 500) })).slice(0, 2000) : [];
    if (!segments.length) return json({ error: "The transcription service returned no timestamped lyric segments. Try another audio file or transcription provider." }, 502);
    return json({ segments, language: payload.language || null });
  } catch (error) { return json({ error: "Could not reach the transcription provider. " + String(error).slice(0, 180) }, 502); }
}