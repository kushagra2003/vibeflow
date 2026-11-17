# VIBE LYRICS service

A separate Python service for timestamped lyric transcription. It is intentionally isolated from the existing VIBE FLOW player and DJ transition engine.

## Current capabilities

- Accepts MP3, WAV, M4A, AAC, OGG, FLAC, MP4 and WebM uploads (80 MB default limit).
- Runs multilingual transcription with faster-whisper.
- Returns segment timestamps and word timestamps where the model provides them.
- Optional Demucs two-stem vocal isolation before ASR.
- Supports Hindi, English and Punjabi language hints. Haryanvi and Bhojpuri currently use Hindi as a baseline and are explicitly marked for manual review.
- Adds basic review tags for repeated lines and emphatic punctuation. These are human-review cues, not a semantic punchline or emotion classifier.
- Lets the VIBE FLOW browser UI edit transcript lines and export JSON.

## Run locally

Requires Python 3.11+ and FFmpeg.

```bash
cd vibe-lyrics
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# Optional: install the large vocal-separation dependency
pip install -r requirements-separation.txt
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs and check http://localhost:8000/health. The health response reports whether Demucs is installed.

## Docker deployment

Build the service directory with vocal isolation enabled:

```bash
docker build --build-arg INSTALL_DEMUCS=1 -t vibe-lyrics .
```

For a smaller transcription-only image, omit the build argument (or set it to 0). Demucs and its PyTorch dependencies make the enabled image substantially larger and need more memory, disk and CPU/GPU resources. First use downloads the Demucs model weights.

Set these runtime environment variables:

- `WHISPER_MODEL=small` (use `medium` for better quality with more RAM/latency)
- `WHISPER_DEVICE=cpu`
- `WHISPER_COMPUTE_TYPE=int8`
- `DEMUCS_MODEL=htdemucs`
- `DEMUCS_TIMEOUT_SECONDS=900`
- `MAX_UPLOAD_MB=80`
- `VIBE_LYRICS_API_TOKEN` to a long random secret
- `CORS_ORIGINS` to the deployed VIBE FLOW origin

CPU separation can be slow. Use a GPU-backed container for production workloads and test the memory limits with representative full-length tracks.

## Connect Netlify

In Netlify site environment variables, set:

- `VIBE_LYRICS_API_URL` = the deployed API base URL (no trailing slash)
- `VIBE_LYRICS_API_TOKEN` = the same secret used by the API
- `LYRICS_ALLOWED_ORIGIN` = your VIBE FLOW site origin

Redeploy the Netlify site after setting variables. The browser calls the Netlify function; the API token stays server-side.

## API

- `GET /health` returns service version and whether vocal isolation is installed.
- `POST /v1/transcribe` multipart fields: `file`, `language`, and optional `separate_vocals=true|false`.

When `separate_vocals=true`, Demucs creates a temporary vocals stem and faster-whisper transcribes that stem. Temporary audio and stems are deleted after the request. The response includes `vocals_separated`, the engine chain and warnings.

## Still planned

IndicConformer specialist routing, WhisperX forced alignment, semantic punchline detection, emotion classification, lyric preference learning, persistent song intelligence and direct DJ cue protection remain future milestones. Haryanvi and Bhojpuri use Hindi decoding only as a baseline.

Only upload recordings you have the rights and permission to process. The service does not retain uploaded audio.


## Optional WhisperX word alignment

Install the optional dependency with `pip install -r requirements-alignment.txt`, or build Docker with `--build-arg INSTALL_ALIGNMENT=1`. To enable both vocal isolation and alignment, use `docker build --build-arg INSTALL_DEMUCS=1 --build-arg INSTALL_ALIGNMENT=1 -t vibe-lyrics .`.

The API accepts `align_words=true` on `POST /v1/transcribe`. It reuses the faster-whisper transcript and asks WhisperX to refine word boundaries against the selected audio (the original track or Demucs vocal stem). The response includes `words_aligned`; the engine string includes `whisperx-align` when successful. If the alignment package is missing, the explicit request returns HTTP 503. If the language has no configured default alignment model or alignment itself fails, the service keeps the original transcript/timestamps and includes a warning.

Set `WHISPERX_DEVICE=cpu` by default, or `cuda` on a correctly provisioned GPU host. `WHISPERX_ALIGN_MODEL` can override the default alignment model for a language, but must be tested with that language/script. WhisperX alignment coverage is language-specific, not universal; the upstream project documents Hindi and English default models among its supported languages. See [WhisperX installation and Python alignment examples](https://github.com/m-bain/whisperX#setup).

WhisperX adds a substantial PyTorch/model dependency. Build and test this optional profile on the actual hosting provider before enabling it for production traffic.
