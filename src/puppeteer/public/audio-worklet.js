/* Continuous Live PCM. No transcript, response, or tool event defines an audio boundary. */
class PuppetAudio extends AudioWorkletProcessor {
  constructor() {
    super();
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
        const pcm = new Int16Array(m.pcm);
        if (this.queuedSamples + pcm.length > 24000 * 2) {
          this.port.postMessage({
            type: "audio.backpressure",
            message: "Dropped Live audio to keep playback under two seconds",
            queuedMs: this.queuedSamples / 24,
          });
          return;
        }
        if (pcm.length) {
          this.queue.push(pcm);
          this.queuedSamples += pcm.length;
        }
      }
    };
  }
  clear() {
    this.queue = [];
    this.offset = 0;
    this.phase = 0;
    this.queuedSamples = 0;
    this.played = 0;
    this.energy = 0;
    this.windowSamples = 0;
    this.windowAdvanced = 0;
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
      if (this.running && this.queue.length) {
        const current = this.queue[0],
          a = current[this.offset],
          b = current[this.offset + 1] ?? this.queue[1]?.[0] ?? a;
        value = (a + (b - a) * this.phase) / 32768;
        this.phase += 24000 / sampleRate;
        while (this.phase >= 1 && this.queue.length) {
          this.phase--;
          this.offset++;
          this.queuedSamples--;
          this.played++;
          if (this.offset === this.queue[0].length) {
            this.queue.shift();
            this.offset = 0;
          }
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
