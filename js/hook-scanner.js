// VIBE FLOW local hook scanner v2.
// Browser-side audio analysis only: no API key, transcription service, or audio upload.
(() => {
  const FRAME_SECONDS = 0.5;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  function pearson(features, a, b, count, dimension) {
    let ma = 0, mb = 0;
    for (let i = 0; i < count; i++) {
      ma += features[a + i][dimension];
      mb += features[b + i][dimension];
    }
    ma /= count; mb /= count;
    let covariance = 0, va = 0, vb = 0;
    for (let i = 0; i < count; i++) {
      const da = features[a + i][dimension] - ma;
      const db = features[b + i][dimension] - mb;
      covariance += da * db; va += da * da; vb += db * db;
    }
    // A nearly constant feature carries no useful comparison signal.
    if (va < 1e-8 || vb < 1e-8) return null;
    return covariance / Math.sqrt(va * vb);
  }

  function similarity(features, a, b, count) {
    const weights = [0.42, 0.14, 0.32, 0.12];
    let score = 0, weight = 0;
    for (let d = 0; d < 4; d++) {
      const r = pearson(features, a, b, count, d);
      if (r === null || !Number.isFinite(r)) continue;
      score += clamp(r, -1, 1) * weights[d];
      weight += weights[d];
    }
    return weight ? score / weight : 0;
  }

  function extractFeatures(buffer) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const sampleRate = buffer.sampleRate;
    const frameSize = Math.max(1, Math.floor(sampleRate * FRAME_SECONDS));
    const frameCount = Math.floor(buffer.length / frameSize);
    const features = new Array(frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * frameSize, end = start + frameSize;
      let squares = 0, diffSquares = 0, peak = 0, crossings = 0, count = 0, previous = 0;
      for (let i = start; i < end; i += 4) {
        let sample = 0;
        for (const channel of channels) sample += channel[i] || 0;
        sample /= Math.max(1, channels.length);
        squares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        if (count && ((sample >= 0) !== (previous >= 0))) crossings++;
        if (count) {
          const diff = sample - previous;
          diffSquares += diff * diff;
        }
        previous = sample;
        count++;
      }
      const rms = Math.sqrt(squares / Math.max(1, count));
      const transient = Math.sqrt(diffSquares / Math.max(1, count - 1));
      const zcr = crossings / Math.max(1, count - 1);
      const crest = peak / Math.max(0.00001, rms);
      features[frame] = [rms, zcr, transient, crest];
    }
    return features;
  }

  function addCandidate(list, candidate, minGapSeconds = 30) {
    const nearby = list.find(item => Math.abs(item.t - candidate.t) < minGapSeconds);
    if (!nearby) list.push(candidate);
    else if (candidate.confidence > nearby.confidence) Object.assign(nearby, candidate);
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
  }

  function findRepeatedSections(features) {
    const found = [];
    // 8, 12, 16 and 24 second phrase lengths. Shorter phrases help songs
    // whose chorus/drop is repeated in compact edits and mashups.
    const frameCounts = [16, 24, 32, 48];
    const energies = features.map(f => f[0]);
    const medianEnergy = percentile(energies, 0.5);
    for (const length of frameCounts) {
      if (features.length < length * 2 + 8) continue;
      const starts = [];
      for (let i = 0; i + length <= features.length; i += 2) starts.push(i);
      for (let x = 0; x < starts.length; x++) {
        const a = starts[x];
        for (let y = x + 1; y < starts.length; y++) {
          const b = starts[y];
          if (b - a < length + 12) continue;
          if (b - a > 360) break;
          const score = similarity(features, a, b, length);
          // Correlation is imperfect for remixes and live arrangements; use
          // a softer threshold while retaining a meaningful pattern match.
          if (score < 0.68) continue;
          const energy = average(features.slice(b, b + length).map(f => f[0]));
          if (energy < Math.max(0.0015, medianEnergy * 0.42)) continue;
          addCandidate(found, {
            t: b * FRAME_SECONDS,
            end: (b + length) * FRAME_SECONDS,
            label: "Repeated musical section",
            type: "repeated-section",
            confidence: clamp(0.62 + (score - 0.68) * 0.75, 0.62, 0.94)
          });
        }
      }
    }
    return found;
  }

  function findEnergySections(features, existing) {
    const length = 16; // 8 seconds.
    if (features.length < length) return;
    const energies = features.map(f => f[0]);
    const medianEnergy = percentile(energies, 0.5);
    const windows = [];
    for (let start = 0; start + length <= features.length; start += 4) {
      const section = features.slice(start, start + length);
      const energy = average(section.map(f => f[0]));
      const movement = average(section.map(f => f[2]));
      const score = energy * 0.72 + movement * 0.28;
      windows.push({ start, energy, movement, score });
    }
    if (!windows.length) return;
    const threshold = percentile(windows.map(x => x.score), 0.65);
    const peaks = [];
    for (let i = 1; i < windows.length - 1; i++) {
      const item = windows[i];
      if (item.energy < Math.max(0.0015, medianEnergy * 0.45)) continue;
      if (item.score < threshold || item.score < windows[i - 1].score || item.score < windows[i + 1].score) continue;
      peaks.push(item);
    }
    // Some highly compressed/mastered songs have a broad plateau rather than
    // a sharp peak. Keep the strongest non-overlapping windows as a fallback.
    if (!peaks.length) {
      const ranked = [...windows].sort((a, b) => b.score - a.score);
      for (const item of ranked) {
        if (item.energy < Math.max(0.0015, medianEnergy * 0.45)) continue;
        if (peaks.every(p => Math.abs(p.start - item.start) >= length * 2)) peaks.push(item);
        if (peaks.length >= 3) break;
      }
    }
    for (const item of peaks) {
      // Detect where the high-energy/drop section actually settles back down.
      // Require three consecutive half-second frames below 62% of the section
      // energy to avoid treating a single kick/snare gap as the hook ending.
      let endFrame = Math.min(features.length, item.start + length);
      const maxLookAhead = Math.min(features.length - 3, item.start + 120); // up to 60 seconds
      for (let frame = item.start + length; frame <= maxLookAhead; frame++) {
        const afterEnergy = average(features.slice(frame, frame + 3).map(f => f[0]));
        if (afterEnergy < item.energy * 0.62) {
          endFrame = frame;
          break;
        }
      }
      addCandidate(existing, {
        t: item.start * FRAME_SECONDS,
        end: endFrame * FRAME_SECONDS,
        label: "High-energy section",
        type: "energy-peak",
        confidence: clamp(0.60 + (item.score / Math.max(threshold, 0.0001) - 1) * 0.10, 0.60, 0.82)
      }, 30);
    }
  }

  async function analyse(url) {
    const analysis = await analyseDetailed(url);
    return (analysis.energyHooks || []).map(hook => ({
      ...hook,
      score: Number(hook.confidence || 0),
      label: hook.label || "Audio energy section"
    }));
  }

  // Detailed structure analysis: BPM, beat phase, bars, 8-bar phrases,
  // intro/outro energy and phrase-aligned mix windows.
  const analysisJobs = new Map();
  async function analyseDetailed(url) {
    if (!url) throw new Error("The song audio URL is missing.");
    const key = new URL(url, document.baseURI).href;
    if (analysisJobs.has(key)) return analysisJobs.get(key);
    const job = (async () => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
      const response = await fetch(key, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Audio download failed (" + response.status + "). This host may block browser-side analysis.");
      const type = response.headers.get("content-type") || "";
      if (/text\/html/i.test(type)) throw new Error("The audio URL returned HTML instead of an audio file.");
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 45 * 1024 * 1024) throw new Error("Audio must be non-empty and under 45 MB for browser analysis.");
      const context = new AudioContextClass();
      try {
        let buffer;
        try { buffer = await context.decodeAudioData(bytes.slice(0)); }
        catch { throw new Error("The audio file could not be decoded by this browser."); }
        if (buffer.duration > 480) throw new Error("Worker analysis is limited to tracks under 8 minutes to protect browser memory.");
        // Resample/mix to mono through the browser audio renderer before transfer.
        // The worker receives ~11 kHz PCM instead of multi-channel 44/48 kHz PCM.
        const targetRate = 11025;
        const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineContext) throw new Error("This browser does not support safe background audio resampling.");
        const offline = new OfflineContext(1, Math.ceil(buffer.duration * targetRate), targetRate);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start(0);
        const monoBuffer = await offline.startRendering();
        const pcm = monoBuffer.getChannelData(0);
        const channels = [pcm];
        const transfers = [pcm.buffer];
        const worker = new Worker(new URL("js/audio-analysis.worker.js", document.baseURI), { type: "classic" });
        try {
          const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Audio analysis worker timed out. Playback can continue; try analysing again later.")), 60000);
            worker.onmessage = event => {
              if (event.data?.ok) { clearTimeout(timeout); resolve(event.data.analysis); }
              else { clearTimeout(timeout); reject(new Error(event.data?.error || "Audio worker failed.")); }
            };
            worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || "Audio worker crashed.")); };
            worker.postMessage({ channels, sampleRate: buffer.sampleRate, duration: buffer.duration }, transfers);
          });
          return result;
        } finally { worker.terminate(); }
      } finally { try { await context.close(); } catch {} }
    })();
    analysisJobs.set(key, job);
    try { return await job; }
    finally { analysisJobs.delete(key); }
  }
  window.VibeHookScanner = Object.freeze({ analyse, analyseDetailed });
})();