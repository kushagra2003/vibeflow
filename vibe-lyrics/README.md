# VIBE LYRICS service (MVP)

A separate Python service for timestamped lyric transcription. It is intentionally isolated from the existing VIBE FLOW player and DJ transition engine.

## What this first slice does

- Accepts MP3, WAV, M4A, AAC, OGG, FLAC, MP4 and WebM uploads (80 MB default limit).
- Runs multilingual transcription with faster-whisper.
- Returns segment timestamps and word timestamps where the model provides them.
- Supports Hindi, English and Punjabi language hints. Haryanvi and Bhojpuri currently use Hindi as a baseline and are explicitly marked for manual review.
- Adds basic review tags for repeated lines and emphatic punctuation. These are cues for a human reviewer, **not** an AI punchline/emotion classifier.
- Lets the VIBE FLOW browser UI edit transcript lines and export JSON.

## Run locally

Requires Python 3.11+ and FFmpeg.

```bash
cd vibe-lyrics
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs and check http://localhost:8000/health.

## Deploy the API

Build and deploy this directory as a Docker service on Render, Railway, Fly.io or another container host. Set:

- `WHISPER_MODEL=small` (use `medium` for better quality with more RAM/latency)
- `WHISPER_DEVICE=cpu`
- `WHISPER_COMPUTE_TYPE=int8`
- `MAX_UPLOAD_MB=80`
- `VIBE_LYRICS_API_TOKEN` to a long random secret
- `CORS_ORIGINS` to the deployed VIBE FLOW origin

The model downloads on first transcription. Provision sufficient disk and memory. CPU deployments are slower; a GPU is recommended for larger models and batch processing.

## Connect Netlify

In Netlify site environment variables, set:

- `VIBE_LYRICS_API_URL` = the deployed API base URL (no trailing slash)
- `VIBE_LYRICS_API_TOKEN` = the same secret used by the API
- `LYRICS_ALLOWED_ORIGIN` = your VIBE FLOW site origin

Redeploy the Netlify site after setting variables. The browser calls the Netlify function; the API token stays server-side.

## API

- `GET /health`
- `POST /v1/transcribe` multipart form fields: `file`, `language`

Response contains detected language, engine, duration, line timestamps, word timestamps, tags and warnings.

## Important model limitations / next work

This MVP uses faster-whisper for every language. It does **not** yet integrate IndicConformer, Demucs vocal separation, WhisperX forced alignment, semantic punchline detection, emotion classification, or DJ cue protection. Haryanvi and Bhojpuri are dialects without dedicated routing in this version; Hindi decoding is only a baseline. Add these as separately benchmarked adapters after collecting a consented evaluation set.

Do not upload copyrighted or private recordings unless you have the rights and permission to process them. Uploaded files are written to a temporary file and deleted after processing; no audio archive is maintained by this service.
