from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_VERSION = "0.2.0"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "80")) * 1024 * 1024
ALLOWED_SUFFIXES = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".mp4", ".webm"}

app = FastAPI(
    title="VIBE LYRICS API",
    version=APP_VERSION,
    description="Vocal-aware transcription and timestamped lyric analysis service for VIBE FLOW.",
)

origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LyricWord(BaseModel):
    text: str
    start: float
    end: float
    probability: float | None = None


class LyricLine(BaseModel):
    id: str
    text: str
    start: float
    end: float
    words: list[LyricWord] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    confidence: float | None = None
    edited: bool = False


class TranscriptionResponse(BaseModel):
    track_name: str
    language: str
    language_probability: float | None
    engine: str
    duration: float
    vocals_separated: bool = False
    lines: list[LyricLine]
    warnings: list[str] = Field(default_factory=list)


def verify_token(authorization: str | None) -> None:
    expected = os.getenv("VIBE_LYRICS_API_TOKEN")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid API token")


def get_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="ASR engine is not installed") from exc
    model_name = os.getenv("WHISPER_MODEL", "small")
    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16")
    global _MODEL
    if _MODEL is None:
        _MODEL = WhisperModel(model_name, device=device, compute_type=compute_type)
    return _MODEL


_MODEL = None


def language_code(language: str) -> str | None:
    return {
        "auto": None,
        "hindi": "hi",
        "english": "en",
        "punjabi": "pa",
        "haryanvi": "hi",
        "bhojpuri": "hi",
    }.get(language)


def separate_vocal_stem(input_path: Path, output_dir: Path) -> Path:
    """Run Demucs two-stem separation and return its vocals.wav output."""
    try:
        import demucs  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Vocal isolation is not installed on this deployment. Rebuild with INSTALL_DEMUCS=1.",
        ) from exc

    model_name = os.getenv("DEMUCS_MODEL", "htdemucs")
    timeout = int(os.getenv("DEMUCS_TIMEOUT_SECONDS", "900"))
    command = [
        os.getenv("PYTHON_EXECUTABLE", "python"),
        "-m", "demucs",
        "--two-stems", "vocals",
        "-n", model_name,
        "-o", str(output_dir),
        str(input_path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Vocal isolation timed out. Try a shorter audio file.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Demucs exited unexpectedly")[-1800:]
        raise HTTPException(status_code=422, detail=f"Vocal isolation failed: {detail}")

    candidates = list(output_dir.glob("**/vocals.wav"))
    if not candidates:
        raise HTTPException(status_code=422, detail="Demucs completed but did not produce a vocals.wav stem.")
    return candidates[0]


def make_lines(segments) -> list[LyricLine]:
    lines: list[LyricLine] = []
    for index, segment in enumerate(segments):
        words = []
        for word in (getattr(segment, "words", None) or []):
            words.append(LyricWord(
                text=(word.word or "").strip(),
                start=round(float(word.start), 3),
                end=round(float(word.end), 3),
                probability=round(float(word.probability), 4) if word.probability is not None else None,
            ))
        text = (segment.text or "").strip()
        if not text:
            continue
        tags = []
        if text.endswith(("!", "!!", "!!!")):
            tags.append("emphatic-punctuation")
        if len(text.split()) <= 5:
            tags.append("short-line")
        lines.append(LyricLine(
            id=f"line-{index + 1}",
            text=text,
            start=round(float(segment.start), 3),
            end=round(float(segment.end), 3),
            words=words,
            tags=tags,
            confidence=round(float(segment.avg_logprob), 4) if getattr(segment, "avg_logprob", None) is not None else None,
        ))
    counts: dict[str, int] = {}
    for line in lines:
        key = " ".join(line.text.casefold().split())
        counts[key] = counts.get(key, 0) + 1
    for line in lines:
        if counts[" ".join(line.text.casefold().split())] > 1:
            line.tags.append("repeated-line")
    return lines


@app.get("/health")
def health():
    try:
        import demucs  # noqa: F401
        demucs_available = True
    except ImportError:
        demucs_available = False
    return {
        "status": "ok",
        "service": "vibe-lyrics",
        "version": APP_VERSION,
        "vocal_isolation_available": demucs_available,
    }


@app.post("/v1/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: Literal["auto", "hindi", "english", "punjabi", "haryanvi", "bhojpuri"] = Form("auto"),
    separate_vocals: bool = Form(False),
    authorization: str | None = Header(default=None),
):
    verify_token(authorization)
    suffix = Path(file.filename or "audio.bin").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Audio exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")

    warnings: list[str] = []
    if language in {"haryanvi", "bhojpuri"}:
        warnings.append("No dedicated dialect model is configured. Hindi-language decoding is used as a baseline; review the transcript manually.")
    if language in {"hindi", "punjabi", "haryanvi", "bhojpuri"}:
        warnings.append("IndicConformer is not wired into this service yet. This request uses multilingual Whisper.")
    if separate_vocals:
        warnings.append("Demucs vocal isolation can reduce instrumental interference, but may introduce artifacts or remove quiet vocals. Review the transcript.")

    try:
        with tempfile.TemporaryDirectory(prefix="vibe-lyrics-") as work_dir:
            work = Path(work_dir)
            input_path = work / f"input{suffix}"
            input_path.write_bytes(data)
            transcription_path = input_path
            if separate_vocals:
                transcription_path = separate_vocal_stem(input_path, work / "separated")

            model = get_model()
            segments, info = model.transcribe(
                str(transcription_path),
                language=language_code(language),
                word_timestamps=True,
                vad_filter=True,
                beam_size=5,
            )
            segments = list(segments)
            lines = make_lines(segments)
            duration = float(getattr(info, "duration", 0.0) or (lines[-1].end if lines else 0.0))
            detected = getattr(info, "language", None) or language_code(language) or "unknown"
            engine = f"demucs:{os.getenv('DEMUCS_MODEL', 'htdemucs')}+faster-whisper:{os.getenv('WHISPER_MODEL', 'small')}" if separate_vocals else f"faster-whisper:{os.getenv('WHISPER_MODEL', 'small')}"
            return TranscriptionResponse(
                track_name=file.filename or "Uploaded audio",
                language=detected,
                language_probability=round(float(info.language_probability), 4) if getattr(info, "language_probability", None) is not None else None,
                engine=engine,
                duration=round(duration, 3),
                vocals_separated=separate_vocals,
                lines=lines,
                warnings=warnings,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Transcription failed: {type(exc).__name__}: {exc}") from exc
    finally:
        await file.close()
