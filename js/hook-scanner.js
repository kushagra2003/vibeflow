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
    if (!url) throw new Error("The song audio URL is missing.");
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support local audio analysis. Try the latest Chrome or Edge.");
    const audioUrl = new URL(url, document.baseURI).href;
    const response = await fetch(audioUrl, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the song audio (" + response.status + "). Check that the file exists in the deployed songs folder.");
    const contentType = response.headers.get("content-type") || "";
    if (/text\/html/i.test(contentType)) throw new Error("The song URL returned the website page instead of an audio file. Check the filename and songs folder deployment.");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("The song audio file is empty.");
    if (bytes.byteLength > 60 * 1024 * 1024) throw new Error("This song is over 60 MB; use a smaller audio file.");
    const context = new AudioContextClass();
    try {
      let decoded;
      try {
        decoded = await context.decodeAudioData(bytes.slice(0));
      } catch {
        throw new Error("The browser fetched the file but could not decode its audio format. Try an MP3 or WAV file.");
      }
      if (decoded.duration > 1200) throw new Error("For performance, local scanning is limited to songs under 20 minutes.");
      const features = extractFeatures(decoded);
      if (features.length < 24) throw new Error("The song is too short to identify musical sections (minimum 12 seconds).");
      const candidates = findRepeatedSections(features);
      findEnergySections(features, candidates);
      // Keep only the strongest candidates, with at least 30 seconds between
      // every accepted hook start across both detection methods.
      const spaced = [];
      for (const candidate of [...candidates].sort((a, b) => b.confidence - a.confidence)) {
        if (spaced.every(item => Math.abs(item.t - candidate.t) >= 30)) spaced.push(candidate);
        if (spaced.length >= 3) break;
      }
      return spaced.sort((a, b) => a.t - b.t);
    } finally {
      try { await context.close(); } catch {}
    }
  }



  // Detailed structure analysis: BPM, beat phase, bars, 8-bar phrases,
  // intro/outro energy and phrase-aligned mix windows.
  async function analyseDetailed(url) {
    if (!url) throw new Error("The song audio URL is missing.");
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
    const audioUrl = new URL(url, document.baseURI).href;
    const response = await fetch(audioUrl, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Audio download failed (" + response.status + "). This host may block browser-side analysis.");
    const type = response.headers.get("content-type") || "";
    if (/text\/html/i.test(type)) throw new Error("The audio URL returned HTML instead of an audio file.");
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 60 * 1024 * 1024) throw new Error("Audio must be non-empty and under 60 MB for browser analysis.");
    const context = new AudioContextClass();
    try {
      const buffer = await context.decodeAudioData(bytes.slice(0));
      if (buffer.duration > 1200) throw new Error("Audio analysis is limited to tracks under 20 minutes.");
      const features = extractFeatures(buffer);
      if (features.length < 24) throw new Error("Track is too short for structural analysis.");
      const seconds = FRAME_SECONDS;
      const duration = buffer.duration;
      const rms = features.map(f => f[0]);
      const transient = features.map(f => f[2]);
      // Use a 20 ms onset envelope for tempo estimation. The 0.5 s
      // structural features are intentionally too coarse for beat tracking.
      const fineFrame = 0.02;
      const fineSize = Math.max(1, Math.floor(buffer.sampleRate * fineFrame));
      const fineCount = Math.floor(buffer.length / fineSize);
      const fineEnergy = new Float32Array(fineCount);
      for (let frame = 0; frame < fineCount; frame++) {
        const from = frame * fineSize, to = from + fineSize;
        let sum = 0, count = 0;
        for (let i = from; i < to; i += 2) {
          let sample = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) sample += buffer.getChannelData(channel)[i] || 0;
          sample /= Math.max(1, buffer.numberOfChannels);
          sum += sample * sample;
          count++;
        }
        fineEnergy[frame] = Math.sqrt(sum / Math.max(1, count));
      }
      const onset = new Float32Array(fineCount);
      let onsetMean = 0;
      for (let i = 1; i < fineCount; i++) {
        onset[i] = Math.max(0, fineEnergy[i] - fineEnergy[i - 1]);
        onsetMean += onset[i];
      }
      onsetMean /= Math.max(1, fineCount - 1);
      for (let i = 0; i < fineCount; i++) onset[i] = Math.max(0, onset[i] - onsetMean * 0.45);
      const bpmScores = [];
      for (let candidateBpm = 60; candidateBpm <= 180; candidateBpm += 1) {
        const lag = Math.max(1, Math.round(60 / candidateBpm / fineFrame));
        let score = 0, count = 0;
        for (let i = lag; i < fineCount; i++) {
          score += onset[i] * onset[i - lag];
          count++;
        }
        bpmScores.push({ bpm: candidateBpm, score: score / Math.max(1, count) });
      }
      bpmScores.sort((a, b) => b.score - a.score);
      let best = bpmScores[0] || { bpm: 120, score: 0 };
      // Resolve common half/double-time ambiguity toward a conventional DJ tempo.
      const alternatives = [best.bpm / 2, best.bpm * 2].filter(x => x >= 60 && x <= 180);
      for (const candidateBpm of alternatives) {
        const candidate = bpmScores.find(x => x.bpm === Math.round(candidateBpm));
        if (candidate && candidate.score >= best.score * 0.82 && candidate.bpm >= 70 && candidate.bpm <= 150) best = candidate;
      }
      const bpm = Math.round(best.bpm * 10) / 10;
      const sortedScores = bpmScores.map(x => x.score).sort((a, b) => a - b);
      const medianScore = sortedScores[Math.floor(sortedScores.length * 0.5)] || 0;
      const bpmConfidence = Math.max(0, Math.min(0.95, (best.score / Math.max(1e-10, medianScore) - 1) / 8));
      const beatSeconds = 60 / bpm;
      const beatFrames = beatSeconds / fineFrame;
      let bestPhase = 0, phaseScore = -1;
      const phaseSteps = Math.max(1, Math.round(beatFrames * 2));
      for (let phase = 0; phase < phaseSteps; phase++) {
        let score = 0;
        for (let frame = phase; frame < onset.length; frame += Math.max(1, Math.round(beatFrames))) score += onset[frame];
        if (score > phaseScore) { phaseScore = score; bestPhase = phase * fineFrame; }
      }
      const beatTimes = [];
      for (let t = bestPhase; t < duration; t += beatSeconds) if (t >= 0) beatTimes.push(Number(t.toFixed(3)));
      const barDuration = beatSeconds * 4;
      const phraseDuration = barDuration * 8;
      const barStarts = [];
      for (let t = bestPhase; t < duration; t += barDuration) if (t >= 0) barStarts.push(Number(t.toFixed(3)));
      const phraseStarts = [];
      for (let t = bestPhase; t < duration; t += phraseDuration) if (t >= 0) phraseStarts.push(Number(t.toFixed(3)));

      const medianRms = percentile(rms, 0.5);
      const activeThreshold = Math.max(0.0015, medianRms * 0.32);
      let introEnd = 0;
      for (let i = 0; i < rms.length; i++) {
        if (rms.slice(i, Math.min(rms.length, i + 4)).filter(v => v > activeThreshold).length >= 3) {
          introEnd = i * seconds; break;
        }
      }
      let outroStart = duration;
      for (let i = rms.length - 1; i >= 3; i--) {
        if (rms.slice(Math.max(0, i - 3), i + 1).filter(v => v > activeThreshold).length >= 3) {
          outroStart = i * seconds; break;
        }
      }
      const snap = (time, grid) => {
        if (!grid.length) return time;
        return grid.reduce((bestTime, t) => Math.abs(t - time) < Math.abs(bestTime - time) ? t : bestTime, grid[0]);
      };
      const mixIn = snap(Math.max(introEnd, Math.min(duration * 0.12, 18)), barStarts);
      const mixOut = snap(Math.max(duration * 0.55, Math.min(outroStart, duration - 18)), barStarts);
      const energyHooks = findRepeatedSections(features);
      findEnergySections(features, energyHooks);
      const spacedHooks = [];
      for (const candidate of [...energyHooks].sort((a, b) => b.confidence - a.confidence)) {
        if (spacedHooks.every(item => Math.abs(item.t - candidate.t) >= 24)) spacedHooks.push(candidate);
        if (spacedHooks.length >= 4) break;
      }
      const onsetAverage = average(Array.from(onset));
      const onsetVariance = average(Array.from(onset, x => (x - onsetAverage) ** 2));
      return {
        version: 1, duration: Number(duration.toFixed(2)), bpm,
        bpmConfidence: Number(bpmConfidence.toFixed(2)),
        beatSeconds: Number(beatSeconds.toFixed(4)),
        beatTimes, barStarts, phraseStarts,
        introEnd: Number(introEnd.toFixed(2)), outroStart: Number(outroStart.toFixed(2)),
        mixIn: Number(mixIn.toFixed(2)), mixOut: Number(mixOut.toFixed(2)),
        energyHooks: spacedHooks,
        energyProfile: {
          low: Number(percentile(rms, 0.2).toFixed(4)),
          median: Number(medianRms.toFixed(4)),
          peak: Number(percentile(rms, 0.95).toFixed(4)),
          onsetVariance: Number(onsetVariance.toFixed(6))
        },
        method: "browser waveform/transient heuristics",
        limitations: ["BPM is an estimate; half-time/double-time ambiguity is possible.", "Energy is not vocal detection.", "Intro/outro are energy-based, not stem-aware."]
      };
    } finally {
      try { await context.close(); } catch {}
    }
  }

  window.VibeHookScanner = Object.freeze({ analyse, analyseDetailed });
})();