import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
function worklet() {
  let Klass: any;
  const messages: any[] = [];
  vm.runInNewContext(
    readFileSync(
      new URL("../public/audio-worklet.js", import.meta.url),
      "utf8",
    ),
    {
      sampleRate: 48000,
      Float32Array,
      Int16Array,
      AudioWorkletProcessor: class {
        port = {
          postMessage: (m: unknown) => messages.push(m),
          onmessage: undefined,
        };
      },
      registerProcessor: (_: string, k: unknown) => {
        Klass = k;
      },
    },
  );
  const node = new Klass(),
    send = (m: unknown) => node.port.onmessage({ data: m });
  const render = (blocks: number, input = 0) => {
    for (let i = 0; i < blocks; i++)
      node.process(
        [[new Float32Array(128).fill(input)]],
        [[new Float32Array(128)]],
      );
  };
  return { node, send, render, messages };
}
it("captures continuous bounded PCM and never interrupts on microphone amplitude", () => {
  const h = worklet();
  h.render(100, 0.4);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(false);
  expect(
    h.messages
      .filter((m) => m.type === "capture")
      .every((m) => m.pcm.byteLength === 4800),
  ).toBe(true);
});
it("reports RMS over the complete 20ms window, not its final block", () => {
  const h = worklet();
  h.send({ type: "start", generation: 1 });
  const pcm = new Int16Array(480);
  pcm.fill(16384, 0, 240);
  h.send({ type: "chunk", generation: 1, pcm: pcm.buffer });
  h.render(8);
  const progress = h.messages.find((m) => m.type === "playback");
  expect(progress.rms).toBeCloseTo(Math.sqrt(0.125), 2);
  expect(progress.elapsedMs).toBe(20);
  h.render(8);
  expect(h.messages.filter((m) => m.type === "playback").at(-1)).toMatchObject({
    rms: 0,
    underrun: true,
    elapsedMs: 20,
  });
});
it("clears immediately and rejects old audio and start epochs", () => {
  const h = worklet();
  h.send({ type: "start", generation: 1 });
  h.send({ type: "clear", generation: 2 });
  h.send({ type: "start", generation: 1 });
  h.send({ type: "chunk", generation: 1, pcm: new Int16Array(100).buffer });
  expect(h.node.queue).toHaveLength(0);
  expect(h.node.running).toBe(false);
});
it("gates microphone samples for mute and push-to-talk", () => {
  const h = worklet();
  h.send({ type: "controls", muted: false, ptt: true, held: false });
  h.render(40, 0.4);
  expect(
    new Int16Array(h.messages.find((m) => m.type === "capture").pcm).every(
      (v) => v === 0,
    ),
  ).toBe(true);
  h.send({ type: "controls", muted: false, ptt: true, held: true });
  h.render(80, 0.4);
  expect(
    new Int16Array(
      h.messages.filter((m) => m.type === "capture").at(-1).pcm,
    ).some((v) => v > 0),
  ).toBe(true);
});
it("bounds playback backlog", () => {
  const h = worklet();
  h.send({ type: "start", generation: 1 });
  h.send({ type: "chunk", generation: 1, pcm: new Int16Array(48001).buffer });
  expect(h.messages.at(-1).type).toBe("audio.error");
});
