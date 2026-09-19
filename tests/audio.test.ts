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
      registerProcessor: (_: string, klass: unknown) => {
        Klass = klass;
      },
    },
  );
  const node = new Klass();
  const send = (m: unknown) => node.port.onmessage({ data: m });
  const render = (blocks: number, input = 0) => {
    for (let i = 0; i < blocks; i++)
      node.process(
        [[new Float32Array(128).fill(input)]],
        [[new Float32Array(128)]],
      );
  };
  return { node, messages, send, render };
}
it("captures bounded PCM chunks and silence does not trigger speech", () => {
  const h = worklet();
  h.render(400);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(false);
  const captures = h.messages.filter((m) => m.type === "capture");
  expect(captures.length).toBeGreaterThan(0);
  expect(captures.every((m) => m.pcm.byteLength === 4800)).toBe(true);
});
it("does not advance the playback clock during an underrun", () => {
  const h = worklet();
  h.send({ type: "start", generation: 1, segment: 0, minDurationMs: 0 });
  h.render(40);
  expect(h.messages.filter((m) => m.type === "playback")).toHaveLength(0);
  h.send({
    type: "chunk",
    generation: 1,
    segment: 0,
    pcm: new Int16Array(2400).fill(3000).buffer,
  });
  h.render(80);
  expect(
    h.messages.filter((m) => m.type === "playback").at(-1).elapsedMs,
  ).toBeCloseTo(100);
  h.send({ type: "end", generation: 1, segment: 0 });
  h.render(1);
  expect(h.messages.at(-1).done).toBe(true);
});
it("interrupts locally and rejects late chunks from the canceled generation", () => {
  const h = worklet();
  h.send({ type: "start", generation: 1, segment: 0, minDurationMs: 0 });
  h.send({
    type: "chunk",
    generation: 1,
    segment: 0,
    pcm: new Int16Array(24000).fill(3000).buffer,
  });
  h.render(60, 0.1);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(true);
  expect(h.node.current).toBe(null);
  h.send({
    type: "chunk",
    generation: 1,
    segment: 0,
    pcm: new Int16Array(2400).buffer,
  });
  expect(h.node.queue).toHaveLength(0);
});
it("muting and push-to-talk gate microphone samples", () => {
  const h = worklet();
  h.send({ type: "controls", muted: true, ptt: false, held: false });
  h.render(80, 0.3);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(false);
  expect(
    new Int16Array(h.messages.find((m) => m.type === "capture").pcm).every(
      (x) => x === 0,
    ),
  ).toBe(true);
  h.send({ type: "controls", muted: false, ptt: true, held: false });
  h.render(80, 0.3);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(false);
  h.send({ type: "controls", muted: false, ptt: true, held: true });
  h.render(80, 0.3);
  expect(h.messages.some((m) => m.type === "speech.start")).toBe(true);
});
