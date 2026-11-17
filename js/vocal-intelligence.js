/* VIBE FLOW vocal timeline.
 * Positive vocal windows are derived from timestamped lyric/word data.
 * A lyric gap is only a candidate instrumental gap, never proof of silence.
 */
(() => {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function buildMap(lines, duration) {
    const raw = [];
    for (let i = 0; i < (lines || []).length; i++) {
      const line = lines[i];
      const words = Array.isArray(line.words) ? line.words : [];
      if (words.length) {
        for (const word of words) {
          const start = Number(word.start ?? word.start_time);
          const end = Number(word.end ?? word.end_time);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start)
            raw.push({ start: Math.max(0, start - 0.35), end: Math.min(duration || Infinity, end + 0.45), confidence: Number(word.confidence ?? 0.9), source: "word-timestamp" });
        }
      } else {
        const start = Number(line.start);
        if (!Number.isFinite(start)) continue;
        const nextStart = Number(lines[i + 1]?.start);
        const explicitEnd = Number(line.end);
        const end = Number.isFinite(explicitEnd) && explicitEnd > start
          ? explicitEnd
          : (Number.isFinite(nextStart) && nextStart > start ? Math.min(nextStart, start + 5) : start + 3);
        raw.push({ start: Math.max(0, start - 0.45), end: Math.min(duration || Infinity, end + 0.6), confidence: 0.65, source: "line-timestamp" });
      }
    }
    raw.sort((a,b)=>a.start-b.start);
    const vocalIntervals = [];
    for (const item of raw) {
      const last = vocalIntervals[vocalIntervals.length - 1];
      if (last && item.start <= last.end + 0.25) {
        last.end = Math.max(last.end, item.end);
        last.confidence = Math.min(last.confidence, item.confidence);
      } else vocalIntervals.push({ ...item });
    }
    const gaps = [];
    let cursor = 0;
    for (const interval of vocalIntervals) {
      if (interval.start - cursor >= 1.8) gaps.push({ start: cursor, end: interval.start, duration: interval.start - cursor, status: "candidate-instrumental-gap", confidence: 0.35 });
      cursor = Math.max(cursor, interval.end);
    }
    if (Number.isFinite(duration) && duration - cursor >= 1.8)
      gaps.push({ start: cursor, end: duration, duration: duration - cursor, status: "candidate-instrumental-gap", confidence: 0.25 });
    return {
      version: 1,
      source: raw.some(x=>x.source==="word-timestamp") ? "word-aligned-lyrics" : "synced-lyric-lines",
      duration: Number(duration || 0),
      vocalIntervals,
      candidateGaps: gaps,
      vocalDetected: vocalIntervals.length > 0,
      vocalAbsenceVerified: false,
      confidence: vocalIntervals.length ? Math.min(...vocalIntervals.map(x=>x.confidence)) : 0,
      limitations: ["Timestamped lyrics positively identify likely vocal passages.", "A gap between lyric timestamps does not prove that backing vocals, ad-libs or wordless singing are absent.", "Do not treat candidate gaps as confirmed instrumental sections."]
    };
  }
  function overlaps(intervals, start, end) {
    return (intervals || []).some(x => x.start < end && x.end > start);
  }
  function planCandidate(outgoing, incoming, outgoingAt, crossfadeSeconds) {
    if (!outgoing || !incoming || !outgoing.vocalIntervals?.length || !incoming.vocalIntervals?.length)
      return { safe: false, reason: "Both tracks need timestamped vocal maps." };
    const fade = Math.max(1, Number(crossfadeSeconds) || 6);
    const outGap = (outgoing.candidateGaps || []).find(g => g.start <= outgoingAt && g.end >= outgoingAt + fade);
    if (!outGap || overlaps(outgoing.vocalIntervals, outgoingAt, outgoingAt + fade))
      return { safe: false, reason: "The outgoing track has no lyric-free candidate gap long enough for this crossfade." };
    const inGap = (incoming.candidateGaps || []).find(g => g.duration >= fade + 2 && g.end < incoming.duration - 5 &&
      !overlaps(incoming.vocalIntervals, g.start, g.start + fade));
    if (!inGap) return { safe: false, reason: "No suitable incoming instrumental candidate gap with a later vocal section was found." };
    const laterVocal = incoming.vocalIntervals.find(v => v.start >= inGap.start + fade);
    if (!laterVocal) return { safe: false, reason: "The incoming track has no later timestamped vocal passage after its candidate gap." };
    return {
      safe: false,
      candidate: true,
      reason: "A lyric-free candidate gap exists, but instrumental status is not verified.",
      outgoingStart: outgoingAt,
      incomingStart: inGap.start,
      incomingNextVocal: laterVocal.start,
      crossfadeSeconds: fade
    };
  }
  window.VibeVocalIntelligence = Object.freeze({ buildMap, planCandidate });
})();