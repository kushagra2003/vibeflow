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
    // Score overlapping 8-second windows from the very beginning of the track.
    // Select strong, time-distributed candidates so a loud late chorus cannot
    // crowd out a useful intro/early hook.
    const energyHooks=[];
    const windowFrames=16,stepFrames=4;
    const candidates=[];
    for(let start=0;start+windowFrames<=frameCount;start+=stepFrames){
      let energy=0,variation=0,peak=0;
      for(let j=start;j<start+windowFrames;j++){
        energy+=rms[j];
        peak=Math.max(peak,rms[j]);
        variation+=Math.abs(rms[j]-rms[Math.max(start,j-1)]);
      }
      energy/=windowFrames;variation/=windowFrames;
      const score=(energy*0.68)+(variation*0.22)+(peak*0.10);
      if(energy>=Math.max(0.0015,medianRms*0.48))
        candidates.push({start,energy,score,confidence:Math.min(.9,.52+(score/Math.max(.0001,medianRms)-0.7)*.08)});
    }
    const chosen=[];
    const addBest=(fromSec,toSec,maxCount)=>{
      const pool=candidates.filter(x=>x.start*frameSeconds>=fromSec&&x.start*frameSeconds<toSec)
        .sort((x,y)=>y.score-x.score);
      for(const candidate of pool){
        if(chosen.every(x=>Math.abs(x.start-candidate.start)>=windowFrames*2)){
          chosen.push(candidate);
          if(chosen.filter(x=>x.start*frameSeconds>=fromSec&&x.start*frameSeconds<toSec).length>=maxCount)break;
        }
      }
    };
    addBest(0,60,2);
    addBest(60,150,1);
    addBest(150,300,1);
    addBest(300,duration,2);
    for(const item of chosen.sort((x,y)=>x.start-y.start)){
      const start=item.start;
      let end=Math.min(frameCount,start+windowFrames);
      const maxEnd=Math.min(frameCount-3,start+120);
      for(let j=start+windowFrames;j<=maxEnd;j++){
        const next=(rms[j]+rms[j+1]+rms[j+2])/3;
        if(next<item.energy*0.62){end=j;break;}
      }
      energyHooks.push({t:Number((start*frameSeconds).toFixed(2)),end:Number((end*frameSeconds).toFixed(2)),label:"Energy section · "+Math.floor(start*frameSeconds/60)+":"+String(Math.floor(start*frameSeconds%60)).padStart(2,"0"),type:"energy-peak",confidence:Number(item.confidence.toFixed(2))});
    }
    const spaced=energyHooks.slice(0,6);
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