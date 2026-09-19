/* Audio capture and playback stay off the browser UI thread. */
class PuppetAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capture = [];
    this.capturePhase = 0;
    this.captureSum = 0;
    this.captureCount = 0;
    this.queue = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.played = 0;
    this.sentProgress = 0;
    this.current = null;
    this.ended = false;
    this.minSamples = 0;
    this.vadHigh = 0;
    this.vadLow = 0;
    this.speaking = false;
    this.muted = false;
    this.ptt = false;
    this.held = false;
    this.localBlocked = false;
    this.port.onmessage = ({ data: m }) => {
      if (m.type === "clear") this.clear();
      else if (m.type === "controls") {
        if (this.held && !m.held && this.ptt) {
          if (this.capture.length) {
            const pcm = new Int16Array(this.capture);
            this.port.postMessage({ type: "capture", pcm: pcm.buffer }, [
              pcm.buffer,
            ]);
            this.capture = [];
          }
          this.port.postMessage({ type: "finalize" });
        }
        this.muted = m.muted;
        this.ptt = m.ptt;
        this.held = m.held;
      } else if (m.type === "start") {
        this.clear();
        this.localBlocked = false;
        this.current = { generation: m.generation, segment: m.segment };
        this.minSamples = Math.ceil((m.minDurationMs * sampleRate) / 1000);
      } else if (m.type === "chunk" && this.matches(m) && !this.localBlocked) {
        const source = new Int16Array(m.pcm),
          ratio = 24000 / sampleRate;
        const output = new Float32Array(Math.round(source.length / ratio));
        for (let i = 0; i < output.length; i++) {
          const p = i * ratio,
            a = Math.floor(p),
            f = p - a;
          output[i] =
            ((source[a] ?? 0) * (1 - f) +
              (source[Math.min(a + 1, source.length - 1)] ?? 0) * f) /
            32768;
        }
        if (this.queuedSamples + output.length > sampleRate * 45) {
          this.port.postMessage({
            type: "audio.error",
            message: "Playback buffer exceeded 45 seconds",
          });
          this.clear();
          return;
        }
        this.queue.push(output);
        this.queuedSamples += output.length;
      } else if (m.type === "end" && this.matches(m)) this.ended = true;
    };
  }
  matches(m) {
    return (
      this.current &&
      m.generation === this.current.generation &&
      m.segment === this.current.segment
    );
  }
  clear() {
    this.queue = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.played = 0;
    this.sentProgress = 0;
    this.current = null;
    this.ended = false;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0],
      out = outputs[0][0];
    const enabled = !this.muted && (!this.ptt || this.held);
    let inputEnergy = 0;
    if (input) for (const value of input) inputEnergy += value * value;
    const inputRms = input ? Math.sqrt(inputEnergy / input.length) : 0;
    if (enabled && inputRms > 0.025) {
      this.vadHigh += out.length / sampleRate;
      this.vadLow = 0;
    } else {
      this.vadLow += out.length / sampleRate;
      this.vadHigh = 0;
    }
    if (!this.speaking && this.vadHigh >= 0.12) {
      this.speaking = true;
      this.localBlocked = true;
      this.port.postMessage({ type: "speech.start" });
      this.clear();
    }
    if (this.speaking && this.vadLow >= 0.4) this.speaking = false;
    // Integrating downsampler to PCM16 at 24kHz; preserve phase across render quanta.
    if (input)
      for (const raw of input) {
        this.captureSum += enabled ? raw : 0;
        this.captureCount++;
        this.capturePhase += 24000;
        if (this.capturePhase >= sampleRate) {
          this.capturePhase -= sampleRate;
          const v = Math.max(
            -1,
            Math.min(1, this.captureSum / this.captureCount),
          );
          this.capture.push(Math.round(v * 32767));
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
      }
    let energy = 0,
      advanced = 0;
    for (let i = 0; i < out.length; i++) {
      let value = 0;
      if (this.current && !this.localBlocked) {
        if (this.queue.length) {
          value = this.queue[0][this.offset++];
          this.queuedSamples--;
          this.played++;
          advanced++;
          if (this.offset >= this.queue[0].length) {
            this.queue.shift();
            this.offset = 0;
          }
        } else if (this.ended && this.played < this.minSamples) {
          this.played++;
          advanced++;
        }
      }
      out[i] = value;
      energy += value * value;
    }
    if (this.current && !this.localBlocked) {
      const done =
        this.ended && !this.queue.length && this.played >= this.minSamples;
      this.sentProgress += out.length;
      if ((this.played > 0 && this.sentProgress >= sampleRate / 20) || done) {
        this.port.postMessage({
          type: "playback",
          ...this.current,
          elapsedMs: (this.played / sampleRate) * 1000,
          rms: Math.sqrt(energy / out.length),
          done,
          underrun: !advanced && !this.ended,
        });
        this.sentProgress = 0;
      }
      if (done) this.current = null;
    }
    return true;
  }
}
registerProcessor("puppet-audio", PuppetAudio);
