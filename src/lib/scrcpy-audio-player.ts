import type { ScrcpyAudioStreamPacket } from "@yume-chan/scrcpy";
import type { ReadableStream } from "@yume-chan/stream-extra";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2;
const PROCESSOR_NAME = "scrcpy-pcm-player";

const WORKLET_SOURCE = `
class ScrcpyPcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.left = new Float32Array(128);
    this.right = new Float32Array(128);
    this.port.onmessage = ({ data }) => {
      if (data.type === "remove") {
        this.streams.delete(data.id);
        return;
      }
      let stream = this.streams.get(data.id);
      if (!stream) {
        stream = {
          queue: [],
          offset: 0,
          bufferedFrames: 0,
          started: false,
          fadeIn: false,
        };
        this.streams.set(data.id, stream);
      }
      if (data.type === "reset") {
        stream.queue = [];
        stream.offset = 0;
        stream.bufferedFrames = 0;
        stream.started = false;
        stream.fadeIn = false;
        return;
      }
      stream.queue.push(data);
      stream.bufferedFrames += data.left.length;
      while (stream.bufferedFrames > sampleRate * 1.5 && stream.queue.length > 1) {
        const dropped = stream.queue.shift();
        stream.bufferedFrames -= dropped.left.length - stream.offset;
        stream.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const outputLeft = output[0];
    const outputRight = output[1];
    outputLeft.fill(0);
    outputRight.fill(0);
    if (this.left.length !== outputLeft.length) {
      this.left = new Float32Array(outputLeft.length);
      this.right = new Float32Array(outputRight.length);
    }

    for (const stream of this.streams.values()) {
      this.left.fill(0);
      this.right.fill(0);
      if (!stream.started) {
        if (stream.bufferedFrames < sampleRate * 0.2) {
          continue;
        }
        stream.started = true;
        stream.fadeIn = true;
      }

      let outputOffset = 0;
      while (outputOffset < this.left.length && stream.queue.length) {
        const chunk = stream.queue[0];
        const available = chunk.left.length - stream.offset;
        const length = Math.min(this.left.length - outputOffset, available);
        this.left.set(chunk.left.subarray(stream.offset, stream.offset + length), outputOffset);
        this.right.set(chunk.right.subarray(stream.offset, stream.offset + length), outputOffset);
        stream.offset += length;
        outputOffset += length;
        stream.bufferedFrames -= length;
        if (stream.offset === chunk.left.length) {
          stream.queue.shift();
          stream.offset = 0;
        }
      }
      if (stream.fadeIn) {
        const fadeLength = Math.min(128, outputOffset);
        for (let i = 0; i < fadeLength; i += 1) {
          const gain = (i + 1) / fadeLength;
          this.left[i] *= gain;
          this.right[i] *= gain;
        }
        stream.fadeIn = false;
      }
      if (!stream.queue.length) {
        const fadeLength = Math.min(128, outputOffset);
        for (let i = 0; i < fadeLength; i += 1) {
          const index = outputOffset - fadeLength + i;
          const gain = 1 - (i + 1) / fadeLength;
          this.left[index] *= gain;
          this.right[index] *= gain;
        }
        stream.started = false;
      }
      for (let i = 0; i < outputLeft.length; i += 1) {
        outputLeft[i] += this.left[i];
        outputRight[i] += this.right[i];
      }
    }
    for (let i = 0; i < outputLeft.length; i += 1) {
      outputLeft[i] = Math.max(-1, Math.min(1, outputLeft[i]));
      outputRight[i] = Math.max(-1, Math.min(1, outputRight[i]));
    }
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", ScrcpyPcmPlayer);
`;

let sharedContext: AudioContext | null = null;
let sharedUsers = 0;
let closeTimer = 0;
let workletContext: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let workletSetup: Promise<AudioWorkletNode> | null = null;
let nextStreamId = 1;

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

function prepareAudioWorklet(context: AudioContext) {
  if (workletContext === context && workletSetup) {
    return workletSetup;
  }
  workletContext = context;
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], {
    type: "text/javascript",
  }));
  workletSetup = context.audioWorklet.addModule(url).then(() => {
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [CHANNELS],
    });
    node.connect(context.destination);
    workletNode = node;
    return node;
  }).finally(() => URL.revokeObjectURL(url));
  return workletSetup;
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
    workletContext = null;
    workletNode?.port.close();
    workletNode?.disconnect();
    workletNode = null;
    workletSetup = null;
    void context.close();
  }, 60_000);
}

export function resumeScrcpyAudio() {
  const context = sharedContext;
  if (context?.state === "suspended") {
    void context.resume().catch(() => undefined);
  }
}

export class ScrcpyPcmAudioPlayer {
  private readonly context = acquireAudioContext();
  private readonly id = nextStreamId++;
  private readonly ready: Promise<AudioWorkletNode>;
  private node?: AudioWorkletNode;
  private remainder = new Uint8Array(0);
  private muted: boolean;
  private disposed = false;

  constructor(muted = false) {
    this.muted = muted;
    this.ready = prepareAudioWorklet(this.context).then((node) => {
      this.node = node;
      if (this.disposed) {
        node.port.postMessage({ type: "remove", id: this.id });
      }
      return node;
    });
    void this.resume();
  }

  async resume() {
    if (!this.disposed && this.context.state === "suspended") {
      await this.context.resume().catch(() => undefined);
    }
  }

  setMuted(muted: boolean) {
    if (this.disposed || this.muted === muted) {
      return;
    }
    this.muted = muted;
    this.remainder = new Uint8Array(0);
    this.node?.port.postMessage({ type: "reset", id: this.id });
    void this.resume();
  }

  async play(stream: ReadableStream<ScrcpyAudioStreamPacket>, signal: AbortSignal) {
    await this.ready;
    if (this.disposed || signal.aborted) {
      return;
    }
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
    this.node?.port.postMessage({ type: "remove", id: this.id });
    this.remainder = new Uint8Array(0);
    releaseAudioContext(this.context);
  }

  private enqueue(data: Uint8Array) {
    if (
      this.muted
      || document.visibilityState === "hidden"
      || this.context.state !== "running"
    ) {
      this.remainder = new Uint8Array(0);
      return;
    }
    let joined = data;
    if (this.remainder.byteLength) {
      joined = new Uint8Array(this.remainder.byteLength + data.byteLength);
      joined.set(this.remainder);
      joined.set(data, this.remainder.byteLength);
    }
    const frames = Math.floor(joined.byteLength / BYTES_PER_FRAME);
    if (!frames || this.disposed) {
      this.remainder = new Uint8Array(joined);
      return;
    }
    const consumed = frames * BYTES_PER_FRAME;
    this.remainder = consumed === joined.byteLength
      ? new Uint8Array(0)
      : new Uint8Array(joined.slice(consumed));

    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const samples = new DataView(joined.buffer, joined.byteOffset, consumed);
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] = samples.getInt16(frame * BYTES_PER_FRAME, true) / 32_768;
      right[frame] = samples.getInt16(frame * BYTES_PER_FRAME + 2, true) / 32_768;
    }

    this.node?.port.postMessage(
      { type: "data", id: this.id, left, right },
      [left.buffer, right.buffer],
    );
  }
}
