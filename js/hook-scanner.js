// VIBE FLOW local hook scanner.
// Analyses audio in the browser: no API key, transcription service, or server upload.
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
    if (va < 1e-9 || vb < 1e-9) return 0;
    return covariance / Math.sqrt(va * vb);
  }

  function similarity(features, a, b, count) {
    const weights = [0.42, 0.14, 0.32, 0.12];
    let score = 0, weight = 0;
    for (let d = 0; d < 4; d++) {
      const r = pearson(features, a, b, count, d);
      score += clamp(r, -1, 1) * weights[d];
      weight += weights[d];
    }
    return score / weight;
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
        sample /= channels.length;
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

  function addCandidate(list, candidate, minGap = 8) {
    const nearby = list.find(item => Math.abs(item.t - candidate.t) < minGap);
    if (!nearby) list.push(candidate);
    else if (candidate.confidence > nearby.confidence) Object.assign(nearby, candidate);
  }

  function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * p)] || 0;
  }

  function findRepeatedSections(features) {
    const found = [];
    const frameCounts = [32, 24]; // 16s and 12s musical phrases.
    for (const length of frameCounts) {
      if (features.length < length * 2 + 20) continue;
      const starts = [];
      for (let i = 0; i + length <= features.length; i += 4) starts.push(i);
      for (let x = 0; x < starts.length; x++) {
        const a = starts[x];
        for (let y = x + 1; y < starts.length; y++) {
          const b = starts[y];
          if (b - a < length + 20) continue;
          if (b - a > 240) break;
          const score = similarity(features, a, b, length);
          if (score < 0.82) continue;
          const energy = average(features.slice(b, b + length).map(f => f[0]));
          if (energy < 0.008) continue;
          addCandidate(found, {
            t: b * FRAME_SECONDS,
            end: (b + length) * FRAME_SECONDS,
            label: "Repeated musical section",
            type: "repeated-section",
            confidence: clamp(score, 0.55, 0.97)
          });
        }
      }
    }
    return found;
  }

  function findEnergySections(features, existing) {
    const length = 24; // 12 seconds.
    if (features.length < length) return;
    const windows = [];
    for (let start = 0; start + length <= features.length; start += 4) {
      const section = features.slice(start, start + length);
      const energy = average(section.map(f => f[0]));
      const movement = average(section.map(f => f[2]));
      windows.push({ start, energy, movement, score: energy * 0.72 + movement * 0.28 });
    }
    const threshold = percentile(windows.map(x => x.score), 0.78);
    for (let i = 1; i < windows.length - 1; i++) {
      const item = windows[i];
      if (item.score < threshold || item.score < windows[i - 1].score || item.score < windows[i + 1].score) continue;
      addCandidate(existing, {
        t: item.start * FRAME_SECONDS,
        end: (item.start + length) * FRAME_SECONDS,
        label: "High-energy section",
        type: "energy-peak",
        confidence: clamp(0.58 + (item.score / Math.max(threshold, 0.0001) - 1) * 0.12, 0.58, 0.78)
      }, 10);
    }
  }

  async function analyse(url) {
    if (!url) throw new Error("The song audio URL is missing.");
    if (!(window.AudioContext || window.webkitAudioContext)) {
      throw new Error("This browser does not support local audio analysis. Try the latest Chrome or Edge.");
    }
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the song audio (" + response.status + ").");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("The song audio file is empty.");
    if (bytes.byteLength > 60 * 1024 * 1024) throw new Error("This song is over 60 MB; use a smaller audio file.");
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const decoded = await context.decodeAudioData(bytes);
      if (decoded.duration > 1200) throw new Error("For performance, local scanning is limited to songs under 20 minutes.");
      const features = extractFeatures(decoded);
      if (features.length < 40) throw new Error("The song is too short to identify repeated sections.");
      const candidates = findRepeatedSections(features);
      findEnergySections(features, candidates);
      return candidates
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 6)
        .sort((a, b) => a.t - b.t);
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("The browser could not decode this audio format.");
    } finally {
      try { await context.close(); } catch {}
    }
  }

  window.VibeHookScanner = Object.freeze({ analyse });
})();