FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ARG INSTALL_DEMUCS=0
ARG INSTALL_ALIGNMENT=0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY requirements-separation.txt .
COPY requirements-alignment.txt .
RUN if [ "$INSTALL_DEMUCS" = "1" ]; then pip install --no-cache-dir -r requirements-separation.txt; fi
RUN if [ "$INSTALL_ALIGNMENT" = "1" ]; then pip install --no-cache-dir -r requirements-alignment.txt; fi
COPY app ./app
ENV PORT=8000 WHISPER_MODEL=small WHISPER_DEVICE=cpu WHISPER_COMPUTE_TYPE=int8
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
