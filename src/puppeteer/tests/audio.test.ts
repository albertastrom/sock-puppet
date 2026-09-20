import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
import {
  PLAYBACK_OVERFLOW_MESSAGE,
  PLAYBACK_QUEUE_SAMPLES,
} from "../src/playback";
function worklet({
  capacitySamples,
  sampleRate = 48000,
}: { capacitySamples?: number; sampleRate?: number } = {}) {
  let Klass: any;
  const messages: any[] = [];
  vm.runInNewContext(
    readFileSync(
      new URL("../public/audio-worklet.js", import.meta.url),
      "utf8",
    ),
    {
      sampleRate,
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
  const node = new Klass(
    capacitySamples
      ? {
          processorOptions: {
            capacitySamples,
            overflowMessage: PLAYBACK_OVERFLOW_MESSAGE,
          },
        }
      : undefined,
  );
  const send = (m: unknown) => node.port.onmessage({ data: m });
  const render = (blocks: number, input = 0, block = 128) => {
    for (let i = 0; i < blocks; i++)
      node.process(
        [[new Float32Array(block).fill(input)]],
        [[new Float32Array(block)]],
      );
  };
  const play = (samples: number) => {
    const heard: number[] = [];
    for (let i = 0; i < samples; i++) {
      const out = [new Float32Array(1)];
      node.process([[new Float32Array(1)]], [out]);
      heard.push(Math.round(out[0][0] * 32768));
    }
    return heard;
  };
  return { node, send, render, play, messages };
}
function sequentialPcm(length: number, start = 0) {
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) pcm[i] = start + i;
  return pcm;
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
  expect(h.node.queuedSamples).toBe(0);
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
it("defaults to a 30-second queue and keeps more than two seconds of burst PCM in order", () => {
  const h = worklet({ sampleRate: 24000 });
  expect(h.node.capacity).toBe(PLAYBACK_QUEUE_SAMPLES);
  h.send({ type: "start", generation: 1 });
  const burst = sequentialPcm(24000 * 3);
  h.send({ type: "chunk", generation: 1, pcm: burst.buffer });
  expect(h.node.queuedSamples).toBe(72000);
  h.render(20);
  expect(h.node.queuedSamples).toBe(72000 - 20 * 128);
  expect(h.node.played).toBe(20 * 128);
  expect(h.node.buffer[h.node.read]).toBe(20 * 128);
  expect(h.messages.some((m) => m.type === "audio.error")).toBe(false);
  expect(h.messages.some((m) => m.type === "audio.backpressure")).toBe(false);
});
it("wraps the ring buffer without reordering samples", () => {
  const h = worklet({ capacitySamples: 32, sampleRate: 24000 });
  h.send({ type: "start", generation: 1 });
  h.send({
    type: "chunk",
    generation: 1,
    pcm: sequentialPcm(32).buffer,
  });
  expect(h.play(10)).toEqual([...Array(10).keys()]);
  h.send({
    type: "chunk",
    generation: 1,
    pcm: sequentialPcm(10, 32).buffer,
  });
  expect(h.node.write).toBe(10);
  expect(h.node.read).toBe(10);
  expect(h.node.queuedSamples).toBe(32);
  expect(h.play(26)).toEqual([
    ...Array.from({ length: 22 }, (_, i) => i + 10),
    ...Array.from({ length: 4 }, (_, i) => i + 32),
  ]);
});
it("faults coherently when unplayed audio would exceed the queue", () => {
  const h = worklet({ capacitySamples: 4800 });
  h.send({ type: "start", generation: 1 });
  h.send({ type: "chunk", generation: 1, pcm: sequentialPcm(4800).buffer });
  expect(h.node.queuedSamples).toBe(4800);
  expect(h.node.running).toBe(true);
  h.send({ type: "chunk", generation: 1, pcm: sequentialPcm(1).buffer });
  expect(h.messages.at(-1)).toMatchObject({
    type: "audio.error",
    message: PLAYBACK_OVERFLOW_MESSAGE,
  });
  expect(h.node.queuedSamples).toBe(0);
  expect(h.node.running).toBe(false);
  h.render(8);
  expect(h.messages.filter((m) => m.type === "playback")).toHaveLength(0);
});
