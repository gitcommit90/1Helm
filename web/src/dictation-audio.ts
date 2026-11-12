// Bounded in-memory startup audio, never storage. One-time server credit lets the
// initial backlog catch up; after that the normal 16kHz PCM16 rate applies.
export class DictationAudio {
  private frames: ArrayBuffer[] = [];
  bytes = 0;
  private credit = 0;
  private at = 0;
  ready = false;
  push(frame: ArrayBuffer) {
    if (!frame.byteLength) return;
    if (frame.byteLength > 16384 || this.bytes + frame.byteLength > 256000) throw new Error('Audio connection took too long. Stop and try again.');
    this.frames.push(frame); this.bytes += frame.byteLength;
  }
  connected(now: number, advertised?: number) {
    if (this.ready) return;
    this.ready = true; this.at = now;
    this.credit = Number.isFinite(advertised) ? Math.max(64000, Math.min(256000, Math.floor(advertised!))) : 64000;
  }
  take(now: number) {
    if (!this.ready) return [];
    // Do not refill the one-time bonus. Leave headroom below the server queue cap.
    this.credit = Math.min(Math.max(64000, this.credit), this.credit + Math.max(0, now - this.at) * 32); this.at = now;
    const out: ArrayBuffer[] = []; let size = 0;
    while (this.frames.length && this.credit >= this.frames[0].byteLength && size + this.frames[0].byteLength <= 16384) {
      const frame = this.frames.shift()!; size += frame.byteLength; this.bytes -= frame.byteLength; this.credit -= frame.byteLength; out.push(frame);
    }
    return out;
  }
  clear() { this.frames.length = 0; this.bytes = 0; }
}
