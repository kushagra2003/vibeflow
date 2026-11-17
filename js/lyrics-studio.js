(() => {
  const panel = document.querySelector("#lyricsStudio");
  if (!panel) return;
  const $ = (selector) => panel.querySelector(selector);
  const titleInput = $("#lyricsTrackTitle");
  const artistInput = $("#lyricsTrackArtist");
  const albumInput = $("#lyricsTrackAlbum");
  const durationInput = $("#lyricsTrackDuration");
  const status = $("#lyricsStatus");
  const result = $("#lyricsResult");
  const findButton = $("#lyricsFind");
  const exportButton = $("#lyricsExport");
  let songData = null;

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function parseTime(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (/^\d+(\.\d+)?s$/.test(raw)) return Number(raw.slice(0, -1));
    const parts = raw.split(":");
    if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function parseTtml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) return [];
    return [...doc.getElementsByTagNameNS("*", "p")].map((paragraph, index) => {
      const spans = [...paragraph.getElementsByTagNameNS("*", "span")];
      const words = spans.map(span => ({
        text: span.textContent || "",
        start: parseTime(span.getAttribute("begin")),
        end: parseTime(span.getAttribute("end")),
      })).filter(word => word.text.trim() && word.start != null && word.end != null);
      const start = parseTime(paragraph.getAttribute("begin")) ?? words[0]?.start;
      const end = parseTime(paragraph.getAttribute("end")) ?? words.at(-1)?.end;
      const text = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
      return { id: "line-" + (index + 1), text, start, end, words, tags: [] };
    }).filter(line => line.text && line.start != null && line.end != null);
  }

  function parseLrc(lrcText) {
    const lines = [];
    const pattern = /^\s*\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/;
    for (const raw of String(lrcText || "").split(/\r?\n/)) {
      const match = raw.match(pattern);
      if (!match || !match[2].trim()) continue;
      const time = parseTime(match[1]);
      if (time != null) lines.push({ start: time, text: match[2].trim() });
    }
    return lines.map((line, index) => ({
      id: "line-" + (index + 1), text: line.text, start: line.start,
      end: lines[index + 1]?.start ?? line.start + 4, words: [], tags: [],
    }));
  }

  function markRepeated(lines) {
    const counts = new Map();
    for (const line of lines) {
      const key = line.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const line of lines) {
      const key = line.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (key && counts.get(key) > 1) line.tags.push("repeated-line");
    }
    return lines;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = new Error(response.status + " " + response.statusText);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function fromBetterLyrics(track) {
    const params = new URLSearchParams({
      s: track.title, a: track.artist, al: track.album || "",
      d: String(Math.round(track.duration)),
    });
    try {
      const data = await fetchJson("https://api.betterlyrics.org/getLyrics?" + params);
      const lines = parseTtml(data.ttml);
      if (lines.length) return { provider: "Better Lyrics · TTML", lines };
    } catch (error) {
      if (![401, 404, 429].includes(error.status)) console.info("Better Lyrics TTML lookup:", error.message);
    }
    try {
      const data = await fetchJson("https://api.betterlyrics.org/kugou/getLyrics?" + params);
      const lines = parseLrc(data.lyrics);
      if (lines.length) return { provider: "Better Lyrics · Kugou", lines };
    } catch (error) {
      console.info("Better Lyrics Kugou lookup:", error.message);
    }
    return null;
  }

  async function fromLrclib(track) {
    const headers = { "X-User-Agent": "VIBE-FLOW/1.0 (https://github.com/kushagra2003/vibeflow)" };
    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    if (track.album) params.set("album_name", track.album);
    if (track.duration > 0) params.set("duration", String(Math.round(track.duration)));
    let record;
    try {
      record = await fetchJson("https://lrclib.net/api/get?" + params, { headers });
    } catch (error) {
      if (error.status !== 404) throw error;
      const search = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
      const matches = await fetchJson("https://lrclib.net/api/search?" + search, { headers });
      record = matches.find(item => item.syncedLyrics) || matches.find(item => item.plainLyrics);
    }
    if (!record) return null;
    const lines = parseLrc(record.syncedLyrics || "");
    if (!lines.length && record.plainLyrics) {
      return {
        provider: "LRCLIB · plain lyrics (not timestamped)",
        lines: record.plainLyrics.split(/\r?\n/).filter(Boolean).map((text, i) => ({
          id: "line-" + (i + 1), text, start: null, end: null, words: [], tags: [],
        })),
      };
    }
    if (lines.length) return {
      provider: record.hasWordSync ? "LRCLIB · word-synced record (LRC view)" : "LRCLIB · line-synced",
      lines,
    };
    return null;
  }

  function render(found, track) {
    songData = {
      track_name: track.title, artist: track.artist, album: track.album,
      duration: track.duration || null, provider: found.provider,
      fetched_at: new Date().toISOString(), lines: markRepeated(found.lines),
    };
    result.replaceChildren();
    const meta = document.createElement("div");
    meta.className = "lyrics-result-meta";
    meta.textContent = track.title + " · " + track.artist + " · " + found.provider + " · " + songData.lines.length + " lines";
    result.append(meta);
    for (const line of songData.lines) {
      const row = document.createElement("article");
      row.className = "lyric-line";
      const time = document.createElement("div");
      time.className = "lyric-line-time";
      time.textContent = line.start == null ? "No timing" : line.start.toFixed(2) + "s – " + line.end.toFixed(2) + "s";
      const editor = document.createElement("textarea");
      editor.rows = 2;
      editor.setAttribute("aria-label", "Edit lyric line");
      editor.value = line.text;
      editor.addEventListener("input", () => { line.text = editor.value; line.edited = true; });
      const tags = document.createElement("div");
      tags.className = "lyric-line-tags";
      for (const tag of line.tags) {
        const chip = document.createElement("span");
        chip.textContent = tag;
        tags.append(chip);
      }
      row.append(time, editor, tags);
      result.append(row);
      if (line.words?.length) {
        const details = document.createElement("details");
        details.className = "lyric-word-details";
        const summary = document.createElement("summary");
        summary.textContent = "Show " + line.words.length + " syllable timestamps";
        const list = document.createElement("div");
        list.className = "lyric-word-list";
        for (const word of line.words) {
          const chip = document.createElement("span");
          chip.textContent = word.text + " · " + word.start.toFixed(2) + "–" + word.end.toFixed(2) + "s";
          list.append(chip);
        }
        details.append(summary, list);
        result.append(details);
      }
    }
    exportButton.hidden = false;
  }

  async function findLyrics() {
    const track = {
      title: titleInput.value.trim(), artist: artistInput.value.trim(),
      album: albumInput.value.trim(), duration: Number(durationInput.value) || 0,
    };
    if (!track.title || !track.artist) {
      setStatus("Enter both a song title and artist.", "error");
      return;
    }
    findButton.disabled = true;
    exportButton.hidden = true;
    result.replaceChildren();
    setStatus("Searching Better Lyrics for syllable timing…", "busy");
    try {
      let found = await fromBetterLyrics(track);
      if (!found) {
        setStatus("No Better Lyrics match. Checking LRCLIB…", "busy");
        found = await fromLrclib(track);
      }
      if (!found) {
        setStatus("No existing lyrics found. Check the title, artist and duration.", "warning");
        return;
      }
      render(found, track);
      const timed = found.lines.some(line => line.start != null);
      setStatus("Lyrics found via " + found.provider + ". " + (timed ? "Review timestamps and edit any mistakes." : "This result has no timestamps."), "success");
    } catch (error) {
      setStatus(error.status === 429
        ? "Lyrics provider rate limit reached. Wait before trying again."
        : "Lyrics lookup failed: " + error.message + ". Try again shortly.", "error");
    } finally {
      findButton.disabled = false;
    }
  }

  function useCurrentTrack() {
    const title = document.querySelector("#title")?.textContent?.trim();
    const artist = document.querySelector("#artist")?.textContent?.trim();
    const time = document.querySelector("#time")?.textContent || "";
    if (!title || !artist || title === "Nothing playing yet" || artist.startsWith("Choose a track")) {
      setStatus("Start a song first, then use this button.", "warning");
      return;
    }
    titleInput.value = title;
    artistInput.value = artist;
    const match = (time.split("/")[1] || "").trim().match(/^(\d+):(\d{2})$/);
    if (match) durationInput.value = String(Number(match[1]) * 60 + Number(match[2]));
    setStatus("Current track details filled in. Add album if known, then find lyrics.", "success");
  }

  function exportJson() {
    if (!songData) return;
    const blob = new Blob([JSON.stringify(songData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (songData.track_name || "track").replace(/[^a-z0-9-_]+/gi, "-") + "-lyrics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  $("#lyricsUseCurrent").addEventListener("click", useCurrentTrack);
  findButton.addEventListener("click", findLyrics);
  exportButton.addEventListener("click", exportJson);
})();