import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { OpenAILive } from "../src/providers/openai-live";
import type { LiveEvent } from "../src/providers/types";
class Socket extends EventEmitter {
  readyState = 1;
  sent: Record<string, any>[] = [];
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.emit("close");
  }
  terminate() {
    this.emit("close");
  }
  event(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
}
afterEach(() => vi.useRealTimers());
async function setup() {
  const socket = new Socket(),
    events: LiveEvent[] = [],
    tool = vi.fn(async () => ({ status: "accepted" }));
  let url = "";
  const provider = new OpenAILive({ OPENAI_API_KEY: "test" }, (u) => {
    url = u;
    return socket as unknown as WebSocket;
  });
  const pending = provider.connect((e) => events.push(e), tool);
  socket.emit("open");
  expect(url).toBe("wss://api.openai.com/v1/live/sessions");
  socket.event({ type: "session.started", session: { id: "s" } });
  const live = await pending;
  const nested = (event: unknown) =>
    socket.event({ type: "response.event", delegation_id: "d", event });
  const end = async () => {
    const closing = live.close();
    socket.event({ type: "session.closed", usage: { seconds: 1 } });
    await closing;
  };
  return { socket, events, tool, live, nested, end };
}
it("configures Live and delegated actions, streams audio without done events", async () => {
  const h = await setup();
  const config = h.socket.sent[0].session;
  expect(config.model).toBe("gpt-live-1");
  expect(config.delegation.responses.tools[0].name).toBe("puppet_act");
  expect(config.delegation.responses.tools[0].parameters.required).toBeUndefined();
  expect(
    config.delegation.responses.tools[0].parameters.properties.move.enum,
  ).toContain("dance");
  expect(
    config.delegation.responses.tools[0].parameters.properties.pitch,
  ).toMatchObject({ minimum: -45, maximum: 45 });
  expect(config.store).toBe(false);
  h.live.send(Buffer.alloc(4800));
  expect(h.socket.sent.at(-1)?.type).toBe("session.input_audio.append");
  h.socket.event({
    type: "session.output_audio.delta",
    delta: Buffer.alloc(960).toString("base64"),
  });
  expect(h.events.at(-1)?.type).toBe("audio");
  await h.end();
});
it("forwards interleaved transcript fragments with session timing", async () => {
  const h = await setup();
  h.socket.event({
    type: "session.input_transcript.delta",
    delta: "Socky, too",
    start_ms: 1000,
    end_ms: 1600,
  });
  h.socket.event({
    type: "session.output_transcript.delta",
    delta: "Mm-h",
    start_ms: 1400,
    end_ms: 1700,
  });
  expect(h.events).toContainEqual({
    type: "transcript",
    role: "user",
    text: "Socky, too",
    startMs: 1000,
    endMs: 1600,
  });
  expect(h.events).toContainEqual({
    type: "transcript",
    role: "assistant",
    text: "Mm-h",
    startMs: 1400,
    endMs: 1700,
  });
  await h.end();
});
it("deduplicates completed function items and continues only after all results", async () => {
  const h = await setup();
  h.nested({ type: "response.created", response: { id: "r" } });
  const item = {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      name: "puppet_act",
      call_id: "c",
      arguments: '{"gesture":"nod"}',
    },
  };
  h.nested(item);
  h.nested(item);
  h.nested({ type: "response.completed", response: { id: "r", output: [] } });
  await vi.waitFor(() =>
    expect(h.socket.sent.some((e) => e.type === "response.create")).toBe(true),
  );
  expect(h.tool).toHaveBeenCalledOnce();
  expect(
    h.socket.sent.filter((e) => e.type === "response.item.create"),
  ).toHaveLength(1);
  await h.end();
});
it("interrupt blocks old delegations even when tool items arrive later", async () => {
  const h = await setup();
  h.socket.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "responses" },
  });
  h.live.interrupt();
  h.nested({ type: "response.created", response: { id: "r" } });
  h.nested({
    type: "response.output_item.done",
    item: {
      type: "function_call",
      name: "puppet_act",
      call_id: "c",
      arguments: '{"gesture":"nod"}',
    },
  });
  h.nested({ type: "response.completed", response: { id: "r" } });
  await Promise.resolve();
  expect(h.tool).not.toHaveBeenCalled();
  expect(h.socket.sent.some((e) => e.type === "response.create")).toBe(false);
  await h.end();
});
it("rejects malformed arguments without executing them", async () => {
  const h = await setup();
  h.nested({ type: "response.created", response: { id: "r" } });
  h.nested({
    type: "response.output_item.done",
    item: {
      type: "function_call",
      name: "puppet_act",
      call_id: "c",
      arguments: "{bad",
    },
  });
  await Promise.resolve();
  expect(h.tool).not.toHaveBeenCalled();
  expect(
    h.socket.sent.find((e) => e.type === "response.item.create")?.item.output,
  ).toContain("rejected");
  await h.end();
});
it("reports missing finalization and closes after a bounded wait", async () => {
  vi.useFakeTimers();
  const h = await setup();
  const close = h.live.close();
  await vi.advanceTimersByTimeAsync(15000);
  await close;
  expect(h.events).toContainEqual({
    type: "usage",
    value: { finalization: "incomplete" },
  });
});
