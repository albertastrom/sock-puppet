function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
export class AudioIO {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private epoch = 0;
  constructor(
    private send: (message: unknown) => void,
    private sendPCM: (pcm: ArrayBuffer) => void,
  ) {}
  async start(deviceId?: string) {
    await this.stop();
    const epoch = ++this.epoch;
    const context = (this.context = new AudioContext());
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        15000,
        "Allow the microphone in the browser address bar, then try again",
      );
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      await context.resume();
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      await context.audioWorklet.addModule("/audio-worklet.js");
      if (epoch !== this.epoch) return false;
      const node = (this.node = new AudioWorkletNode(context, "puppet-audio", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      }));
      node.port.onmessage = ({ data }) => {
        if (epoch !== this.epoch) return false;
        if (data.type === "capture") this.sendPCM(data.pcm);
        else if (data.type === "speech.start") this.send({ type: "interrupt" });
        else this.send(data);
      };
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(node);
      node.connect(context.destination);
      stream.getAudioTracks()[0].onended = () =>
        this.send({ type: "audio.error", message: "Microphone disconnected" });
      context.onstatechange = () => {
        if (epoch === this.epoch && context.state === "suspended")
          this.send({
            type: "audio.error",
            message:
              "Audio playback suspended; resume the session with the page visible",
          });
      };
      return true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  control(muted: boolean, ptt: boolean, held: boolean) {
    this.node?.port.postMessage({ type: "controls", muted, ptt, held });
  }
  handle(message: Record<string, unknown>) {
    if (message.type === "audio.clear")
      this.node?.port.postMessage({ type: "clear" });
    if (message.type === "audio.start")
      this.node?.port.postMessage({ ...message, type: "start" });
    if (message.type === "audio.end")
      this.node?.port.postMessage({ ...message, type: "end" });
    if (message.type === "audio.chunk" && typeof message.pcm === "string") {
      const bytes = Uint8Array.from(atob(message.pcm), (c) => c.charCodeAt(0));
      this.node?.port.postMessage(
        { ...message, type: "chunk", pcm: bytes.buffer },
        [bytes.buffer],
      );
    }
  }
  async stop() {
    this.epoch++;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = undefined;
    const ctx = this.context;
    this.context = undefined;
    if (ctx && ctx.state !== "closed") await ctx.close();
  }
}
