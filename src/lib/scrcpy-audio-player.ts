import type { ScrcpyAudioStreamPacket } from "@yume-chan/scrcpy";
import type { ReadableStream } from "@yume-chan/stream-extra";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2;

let sharedContext: AudioContext | null = null;
let sharedUsers = 0;
let closeTimer = 0;

function getAudioContext() {
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  sharedContext = new AudioContext({ latencyHint: "interactive", sampleRate: SAMPLE_RATE });
  return sharedContext;
}

function acquireAudioContext() {
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  }
  sharedUsers += 1;
  return getAudioContext();
}

function releaseAudioContext(context: AudioContext) {
  sharedUsers = Math.max(sharedUsers - 1, 0);
  if (sharedUsers) {
    return;
  }
  closeTimer = window.setTimeout(() => {
    closeTimer = 0;
    if (sharedUsers || sharedContext !== context) {
      return;
    }
    sharedContext = null;
    void context.close();
  }, 2_000);
}

export function resumeScrcpyAudio() {
  const context = getAudioContext();
  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }
}

export class ScrcpyPcmAudioPlayer {
  private readonly context = acquireAudioContext();
  private readonly gain = this.context.createGain();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private disposed = false;

  constructor(muted = false) {
    this.gain.gain.value = muted ? 0 : 1;
    this.gain.connect(this.context.destination);
    void this.resume();
  }

  async resume() {
    if (!this.disposed && this.context.state === "suspended") {
      await this.context.resume().catch(() => undefined);
    }
  }

  setMuted(muted: boolean) {
    if (this.disposed) {
      return;
    }
    this.gain.gain.setValueAtTime(muted ? 0 : 1, this.context.currentTime);
    if (!muted) {
      void this.resume();
    }
  }

  async play(stream: ReadableStream<ScrcpyAudioStreamPacket>, signal: AbortSignal) {
    const reader = stream.getReader();
    const cancel = () => void reader.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (!this.disposed && !signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        if (value.type === "data") {
          this.enqueue(value.data);
        }
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.gain.disconnect();
    releaseAudioContext(this.context);
  }

  private enqueue(data: Uint8Array) {
    const frames = Math.floor(data.byteLength / BYTES_PER_FRAME);
    if (!frames || this.disposed || this.context.state === "closed") {
      return;
    }

    const buffer = this.context.createBuffer(CHANNELS, frames, SAMPLE_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const samples = new DataView(data.buffer, data.byteOffset, frames * BYTES_PER_FRAME);
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] = samples.getInt16(frame * BYTES_PER_FRAME, true) / 32_768;
      right[frame] = samples.getInt16(frame * BYTES_PER_FRAME + 2, true) / 32_768;
    }

    const now = this.context.currentTime;
    if (this.nextStartTime < now || this.nextStartTime > now + 0.25) {
      this.nextStartTime = now + 0.04;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.addEventListener("ended", () => {
      this.sources.delete(source);
      source.disconnect();
    }, { once: true });
    this.sources.add(source);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }
}
