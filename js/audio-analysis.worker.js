/* VIBE FLOW audio analysis worker.
 * CPU-heavy sample loops run off the UI thread. Input is decoded PCM transferred
 * from the main thread; this worker never touches the playback audio elements.
 */
self.onmessage = event => {
  const { id, channels, sampleRate, duration } = event.data || {};
  try {
    if (!Array.isArray(channels) || !channels.length) throw new Error("No decoded audio channels were supplied.");
    const frameSeconds = 0.5;
    const fineSeconds = 0.02;
    const channelCount = channels.length;
    const sampleCount = channels[0].length;
    const fineSize = Math.max(1, Math.floor(sampleRate * fineSeconds));
    const fineCount = Math.floor(sampleCount / fineSize);
    const fineEnergy = new Float32Array(fineCount);
    for (let frame = 0; frame < fineCount; frame++) {
      const from = frame * fineSize, to = Math.min(sampleCount, from + fineSize);
      let sum = 0, count = 0;
      for (let i = from; i < to; i += 4) {
        let sample = 0;
        for (let c = 0; c < channelCount; c++) sample += channels[c][i] || 0;
        sample /= channelCount;
        sum += sample * sample; count++;
      }
      fineEnergy[frame] = Math.sqrt(sum / Math.max(1, count));
    }
    const onset = new Float32Array(fineCount);
    let onsetMean = 0;
    for (let i = 1; i < fineCount; i++) { onset[i] = Math.max(0, fineEnergy[i] - fineEnergy[i - 1]); onsetMean += onset[i]; }
    onsetMean /= Math.max(1, fineCount - 1);
    for (let i = 0; i < fineCount; i++) onset[i] = Math.max(0, onset[i] - onsetMean * 0.45);

    const scores = [];
    for (let bpm = 60; bpm <= 180; bpm++) {
      const lag = Math.max(1, Math.round(60 / bpm / fineSeconds));
      let score = 0, count = 0;
      for (let i = lag; i < fineCount; i++) { score += onset[i] * onset[i - lag]; count++; }
      scores.push({ bpm, score: score / Math.max(1, count) });
    }
    scores.sort((a, b) => b.score - a.score);
    let best = scores[0] || { bpm: 120, score: 0 };
    for (const bpm of [best.bpm / 2, best.bpm * 2]) {
      if (bpm < 60 || bpm > 180) continue;
      const alternative = scores.find(x => x.bpm === Math.round(bpm));
      if (alternative && alternative.score >= best.score * 0.82 && alternative.bpm >= 70 && alternative.bpm <= 150) best = alternative;
    }
    const sorted = scores.map(x => x.score).sort((a,b)=>a-b);
    const median = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const confidence = Math.max(0, Math.min(0.95, (best.score / Math.max(1e-10, median) - 1) / 8));
    const bpm = Math.round(best.bpm * 10) / 10;
    const beatSeconds = 60 / bpm;
    const phaseSteps = Math.max(1, Math.round(beatSeconds / fineSeconds * 2));
    let phase = 0, phaseScore = -1;
    for (let p = 0; p < phaseSteps; p++) {
      let score = 0;
      for (let i = p; i < onset.length; i += Math.max(1, Math.round(beatSeconds / fineSeconds))) score += onset[i];
      if (score > phaseScore) { phaseScore = score; phase = p * fineSeconds; }
    }
    const beatTimes = [], barStarts = [], phraseStarts = [];
    for (let t = phase; t < duration; t += beatSeconds) beatTimes.push(Number(t.toFixed(3)));
    for (let t = phase; t < duration; t += beatSeconds * 4) barStarts.push(Number(t.toFixed(3)));
    for (let t = phase; t < duration; t += beatSeconds * 32) phraseStarts.push(Number(t.toFixed(3)));

    const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
    const frameCount = Math.floor(sampleCount / frameSize);
    const rms = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      const from = frame * frameSize, to = Math.min(sampleCount, from + frameSize);
      let sum = 0, count = 0;
      for (let i = from; i < to; i += 4) {
        let sample = 0;
        for (let c = 0; c < channelCount; c++) sample += channels[c][i] || 0;
        sample /= channelCount; sum += sample * sample; count++;
      }
      rms[frame] = Math.sqrt(sum / Math.max(1, count));
    }
    const sortedRms = Array.from(rms).sort((a,b)=>a-b);
    const percentile = p => sortedRms[Math.floor((sortedRms.length - 1) * p)] || 0;
    const medianRms = percentile(0.5), threshold = Math.max(0.0015, medianRms * 0.32);
    let introEnd = 0, outroStart = duration;
    for (let i = 0; i < frameCount; i++) {
      let active = 0; for (let j=i;j<Math.min(frameCount,i+4);j++) if(rms[j]>threshold)active++;
      if(active>=3){introEnd=i*frameSeconds;break;}
    }
    for (let i=frameCount-1;i>=3;i--) {
      let active=0;for(let j=Math.max(0,i-3);j<=i;j++)if(rms[j]>threshold)active++;
      if(active>=3){outroStart=i*frameSeconds;break;}
    }
    const energyHooks=[];
    for(let i=2;i<frameCount-2;i++){
      const local=(rms[i-2]+rms[i-1]+rms[i]+rms[i+1]+rms[i+2])/5;
      if(local>medianRms*1.35 && rms[i]>=rms[i-1] && rms[i]>=rms[i+1]){
        if(energyHooks.every(h=>Math.abs(h.t-i*frameSeconds)>=24))
          energyHooks.push({t:Number((i*frameSeconds).toFixed(2)),end:Number(Math.min(duration,(i+8)*frameSeconds).toFixed(2)),label:"Energy section",type:"energy-peak",confidence:Math.min(.8,.55+local/Math.max(.001,medianRms)*.03)});
      }
    }
    energyHooks.sort((a,b)=>b.confidence-a.confidence);
    const spaced=energyHooks.slice(0,4).sort((a,b)=>a.t-b.t);
    self.postMessage({id,ok:true,analysis:{
      version:2,duration:Number(duration.toFixed(2)),bpm,bpmConfidence:Number(confidence.toFixed(2)),
      beatSeconds:Number(beatSeconds.toFixed(4)),beatTimes,barStarts,phraseStarts,
      introEnd:Number(introEnd.toFixed(2)),outroStart:Number(outroStart.toFixed(2)),
      mixIn:Number(introEnd.toFixed(2)),mixOut:Number(outroStart.toFixed(2)),energyHooks:spaced,
      energyProfile:{low:Number(percentile(.2).toFixed(4)),median:Number(medianRms.toFixed(4)),peak:Number(percentile(.95).toFixed(4))},
      method:"Web Worker PCM waveform analysis",
      vocalStatus:"not-detected",
      limitations:["This analysis estimates rhythm and energy only; it does not identify vocals.","Lyrics timestamps can mark known vocal activity, but a lyric gap does not prove an instrumental section."]
    }});
  } catch(error) { self.postMessage({id,ok:false,error:error.message||String(error)}); }
};