(() => {
  const panel = document.querySelector("#lyricsStudio");
  if (!panel) return;
  const $ = (selector) => panel.querySelector(selector);
  const fileInput = $("#lyricsFile");
  const status = $("#lyricsStatus");
  const result = $("#lyricsResult");
  const transcribeButton = $("#lyricsTranscribe");
  const exportButton = $("#lyricsExport");
  let transcript = null;

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function render(data) {
    transcript = data;
    result.innerHTML = "";
    if (!data.lines?.length) {
      result.innerHTML = '<p class="lyrics-empty">No speech segments were detected. Try another language or a clearer audio file.</p>';
      return;
    }
    const header = document.createElement("div");
    header.className = "lyrics-result-meta";
    header.textContent = `${data.language.toUpperCase()} · ${data.engine} · ${data.lines.length} segments · ${data.duration.toFixed(1)} sec`;
    result.append(header);

    for (const line of data.lines) {
      const row = document.createElement("article");
      row.className = "lyric-line";
      row.innerHTML = `
        <div class="lyric-line-time">${line.start.toFixed(2)}s – ${line.end.toFixed(2)}s</div>
        <textarea aria-label="Edit lyric line" rows="2">${escapeHtml(line.text)}</textarea>
        <div class="lyric-line-tags">${(line.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`;
      row.querySelector("textarea").addEventListener("input", (event) => {
        line.text = event.target.value;
        line.edited = true;
      });
      result.append(row);
      if (line.words?.length) {
        const details = document.createElement("details");
        details.className = "lyric-word-details";
        const summary = document.createElement("summary");
        summary.textContent = "Show " + line.words.length + " word timestamps";
        details.append(summary);
        const wordList = document.createElement("div");
        wordList.className = "lyric-word-list";
        for (const word of line.words) {
          const chip = document.createElement("span");
          chip.textContent = word.text + " · " + word.start.toFixed(2) + "–" + word.end.toFixed(2) + "s";
          wordList.append(chip);
        }
        details.append(wordList);
        result.append(details);
      }
    }
    for (const warning of data.warnings || []) {
      const item = document.createElement("p");
      item.className = "lyrics-warning";
      item.textContent = warning;
      result.append(item);
    }
    exportButton.hidden = false;
  }

  async function transcribe() {
    const file = fileInput.files?.[0];
    if (!file) {
      setStatus("Choose an audio file first.", "error");
      return;
    }
    transcribeButton.disabled = true;
    exportButton.hidden = true;
    result.replaceChildren();
    const isolate = $("#lyricsSeparateVocals").checked;
    const align = $("#lyricsAlignWords").checked;
    setStatus(align ? "Generating transcript and refining word-level timing. This can take several minutes…" : isolate ? "Separating vocals, then generating timestamped lyrics. This can take several minutes…" : "Uploading audio and generating timestamped lyrics…", "busy");
    const body = new FormData();
    body.append("file", file);
    body.append("language", $("#lyricsLanguage").value);
    body.append("separate_vocals", isolate ? "true" : "false");
    body.append("align_words", align ? "true" : "false");
    try {
      const response = await fetch("/api/lyrics?path=v1/transcribe", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || `Request failed (${response.status})`);
      render(payload);
      const completed = [];
      if (payload.vocals_separated) completed.push("Vocals isolated");
      if (payload.words_aligned) completed.push("word timings aligned");
      setStatus((completed.length ? completed.join(" · ") : "Transcript ready") + ". Review the words and export JSON.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      transcribeButton.disabled = false;
    }
  }

  function exportJson() {
    if (!transcript) return;
    const blob = new Blob([JSON.stringify(transcript, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(transcript.track_name || "track").replace(/[^a-z0-9-_]+/gi, "-")}-lyrics.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  transcribeButton.addEventListener("click", transcribe);
  exportButton.addEventListener("click", exportJson);
  fetch("/api/lyrics?path=health")
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(data => {
      const capabilities = ["Lyrics service connected"];
      capabilities.push(data.vocal_isolation_available ? "vocal isolation ready" : "vocal isolation not installed");
      capabilities.push(data.word_alignment_available ? "WhisperX alignment ready" : "WhisperX alignment not installed");
      setStatus(capabilities.join(" · "), "success");
    })
    .catch(() => setStatus("Lyrics service is not connected yet. Lyrics API is not connected. Configure VIBE_LYRICS_API_URL and VIBE_LYRICS_API_TOKEN in your Cloudflare Pages project, then redeploy.", "warning"));
})();
