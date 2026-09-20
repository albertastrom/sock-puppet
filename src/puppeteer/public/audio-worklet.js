/* Continuous Live PCM. No transcript, response, or tool event defines an audio boundary. */
const DEFAULT_CAPACITY = 24000 * 30;
class PuppetAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options?.processorOptions?.capacitySamples;
    const overflow =
      typeof options?.processorOptions?.overflowMessage === "string"
        ? options.processorOptions.overflowMessage
        : "Playback queue exceeded 30 seconds of unplayed audio";
    this.capacity =
      Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : DEFAULT_CAPACITY;
    this.overflowMessage = overflow;
    this.buffer = new Int16Array(this.capacity);
    this.capture = [];
    this.capturePhase = 0;
    this.captureSum = 0;
    this.captureCount = 0;
    this.muted = false;
    this.ptt = false;
    this.held = false;
    this.generation = -1;
    this.running = false;
    this.clear();
    this.port.onmessage = ({ data: m }) => {
      if (m.type === "controls") {
        this.muted = m.muted;
        this.ptt = m.ptt;
        this.held = m.held;
      } else if (m.type === "clear" && m.generation >= this.generation) {
        this.generation = m.generation;
        this.running = false;
        this.clear();
      } else if (m.type === "start" && m.generation > this.generation) {
        this.generation = m.generation;
        this.clear();
        this.running = true;
      } else if (
        m.type === "chunk" &&
        this.running &&
        m.generation === this.generation
      ) {
        this.enqueue(new Int16Array(m.pcm));
      }
    };
  }
  peek(offset) {
    let index = this.read + offset;
    if (index >= this.capacity) index -= this.capacity;
    return this.buffer[index];
  }
  enqueue(pcm) {
    if (!pcm.length) return;
    if (this.queuedSamples + pcm.length > this.capacity) {
      this.port.postMessage({
        type: "audio.error",
        message: this.overflowMessage,
      });
      this.running = false;
      this.clear();
      return;
    }
    const first = Math.min(pcm.length, this.capacity - this.write);
    this.buffer.set(pcm.subarray(0, first), this.write);
    if (first < pcm.length) this.buffer.set(pcm.subarray(first), 0);
    this.write += pcm.length;
    if (this.write >= this.capacity) this.write -= this.capacity;
    this.queuedSamples += pcm.length;
    if (this.queuedSamples > this.highWater) this.highWater = this.queuedSamples;
  }
  clear() {
    this.read = 0;
    this.write = 0;
    this.queuedSamples = 0;
    this.played = 0;
    this.phase = 0;
    this.energy = 0;
    this.windowSamples = 0;
    this.windowAdvanced = 0;
    this.highWater = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0],
      out = outputs[0][0];
    const enabled = !this.muted && (!this.ptt || this.held);
    for (let i = 0; i < out.length; i++) {
      this.captureSum += enabled ? (input?.[i] ?? 0) : 0;
      this.captureCount++;
      this.capturePhase += 24000;
      if (this.capturePhase >= sampleRate) {
        this.capturePhase -= sampleRate;
        this.capture.push(
          Math.round(
            Math.max(-1, Math.min(1, this.captureSum / this.captureCount)) *
              32767,
          ),
        );
        this.captureSum = 0;
        this.captureCount = 0;
        if (this.capture.length === 2400) {
          const pcm = new Int16Array(this.capture);
          this.port.postMessage({ type: "capture", pcm: pcm.buffer }, [
            pcm.buffer,
          ]);
          this.capture = [];
        }
      }
      let value = 0;
      if (this.running && this.queuedSamples) {
        const a = this.buffer[this.read],
          b = this.queuedSamples > 1 ? this.peek(1) : a;
        value = (a + (b - a) * this.phase) / 32768;
        this.phase += 24000 / sampleRate;
        while (this.phase >= 1 && this.queuedSamples) {
          this.phase--;
          this.read++;
          if (this.read === this.capacity) this.read = 0;
          this.queuedSamples--;
          this.played++;
        }
        this.windowAdvanced++;
      }
      out[i] = value;
      if (this.running) {
        this.energy += value * value;
        this.windowSamples++;
        if (this.windowSamples >= Math.round(sampleRate * 0.02)) {
          this.port.postMessage({
            type: "playback",
            generation: this.generation,
            elapsedMs: this.played / 24,
            rms: Math.sqrt(this.energy / this.windowSamples),
            queuedMs: this.queuedSamples / 24,
            highWaterMs: this.highWater / 24,
            underrun: this.windowAdvanced === 0,
          });
          this.energy = 0;
          this.windowSamples = 0;
          this.windowAdvanced = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("puppet-audio", PuppetAudio);
