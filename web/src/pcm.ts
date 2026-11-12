// 16-bit PCM audio from the microphone, shared by live dictation (dictate.ts) and Live notes chunks (livemic.ts).
// The worklet turns the audio context's own rate (usually 44.1 or 48 kHz) into mono 16 kHz, 16-bit samples, 100 ms at a time.
// 16 kHz is the rate speech models are trained on, and it is the rate live dictation already sends. A WAV file of it is 32 KB per
// second (1.9 MB a minute), so a 5-minute recording is 9.6 MB, under the server's 25 MB limit for POST /api/transcribe, and a
// 10-second Live notes chunk is 320 KB, under its 3 MB limit. A 48 kHz file would be 3 times larger and break both limits.
export const PCM_RATE = 16000;
export const WAV_TYPE = 'audio/wav';
// name: the processor's registered name. levels: also post each block's peak level (dictation's voice-level glow).
export const pcmProcessor = (name: string, levels = false) => `class PCMWorklet extends AudioWorkletProcessor {
  constructor(){super();this.sum=0;this.count=0;this.phase=0;this.chunk=[];this.stopped=false;
    this.port.onmessage=e=>{if(e.data==='stop'){this.stopped=true;this.flush();this.port.postMessage({type:'flushed'});}};}
  flush(){if(!this.chunk.length)return;const pcm=new Int16Array(this.chunk);this.chunk=[];this.port.postMessage({type:'audio',pcm:pcm.buffer},[pcm.buffer]);}
  process(inputs){if(this.stopped)return false;const data=inputs[0]?.[0];if(!data)return true;let peak=0;
    for(const v of data){peak=Math.max(peak,Math.abs(v));this.sum+=v;this.count++;this.phase+=${PCM_RATE};
      if(this.phase>=sampleRate){this.phase-=sampleRate;const x=Math.max(-1,Math.min(1,this.sum/this.count));this.chunk.push(Math.round(x*(x<0?32768:32767)));this.sum=0;this.count=0;if(this.chunk.length>=1600)this.flush();}}
    ${levels ? "this.port.postMessage({type:'level',value:peak});" : ''}return true;}
}registerProcessor(${JSON.stringify(name)},PCMWorklet);`;

// A WAV file (RIFF header, mono, 16-bit PCM) around raw little-endian PCM frames. The samples are not changed.
export function wavOf(frames: ArrayBuffer[], rate = PCM_RATE): Blob {
  let n = 0; for (const f of frames) n += f.byteLength;
  const h = new DataView(new ArrayBuffer(44)), tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) h.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); h.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); tag(36, 'data'); h.setUint32(40, n, true);
  return new Blob([h.buffer, ...frames], { type: WAV_TYPE });
}
