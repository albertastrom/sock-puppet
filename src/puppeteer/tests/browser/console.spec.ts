import { test, expect, type Page } from "@playwright/test";
import { OPERATOR_PROTOCOL_VERSION } from "../../src/playback";

async function chromeBox(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header")!.getBoundingClientRect();
    const aside = document.querySelector("aside")!.getBoundingClientRect();
    const conversation = [
      ...document.querySelectorAll("h3"),
    ].find((h) => h.textContent === "Conversation")!;
    const connection = [
      ...document.querySelectorAll("h3"),
    ].find((h) => h.textContent === "Robot connection")!;
    const pill = document.querySelector(".session-pill")!.getBoundingClientRect();
    return {
      headerHeight: Math.round(header.height),
      asideLeft: Math.round(aside.left),
      asideWidth: Math.round(aside.width),
      conversationTop: Math.round(conversation.getBoundingClientRect().top),
      connectionTop: Math.round(connection.getBoundingClientRect().top),
      pillTop: Math.round(pill.top),
      pillHeight: Math.round(pill.height),
    };
  });
}

test("controls the actual twin through the puppeteer WebSocket and survives reconnect", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Puppeteer" })).toBeVisible();
  await expect(page.getByText("Controller online")).toBeVisible();
  const twin = await context.newPage();
  await twin.goto("http://127.0.0.1:15173");
  await twin.getByLabel("WebSocket URL").fill("ws://127.0.0.1:18887");
  await twin.getByRole("button", { name: "Connect", exact: true }).click();
  await page.bringToFront();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "headPitch" }),
  ).toContainText("10.0°");
  await twin.bringToFront();
  await expect(twin.getByTestId("headPitch-actual")).toHaveText("10.0°");
  await page.bringToFront();
  await page.getByLabel("Robot command JSON").fill(
    JSON.stringify({
      version: 2,
      type: "command",
      id: "long-move",
      motors: { baseYaw: { angleDeg: 90, speedDegPerSec: 10 } },
    }),
  );
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "baseYaw" }),
  ).toContainText("90.0°");
  await page.getByRole("button", { name: "Stop motion", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "baseYaw" }),
  ).toContainText("Still");
  await expect(
    page.getByRole("row").filter({ hasText: "baseYaw" }),
  ).not.toContainText("90.0°");
  await twin.bringToFront();
  await twin.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.bringToFront();
  await expect(page.getByText("Waiting", { exact: true })).toBeVisible();
  await twin.bringToFront();
  await twin.getByRole("button", { name: "Connect", exact: true }).click();
  await page.bringToFront();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/console-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/console-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await twin.close();
});
test("reports microphone denial without starting a session", async ({
  page,
}) => {
  await page.routeWebSocket("**/operator", (ws) => {
    const server = ws.connectToServer();
    server.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "ready") {
        m.hasApiKey = true;
        m.connected = true;
      }
      ws.send(JSON.stringify(m));
    });
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Puppeteer" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start listening" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByRole("alert")).toContainText("Microphone unavailable");
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
});

test("plays streaming PCM through a real AudioWorklet and releases the microphone", async ({
  page,
}) => {
  const progress: { elapsedMs: number; underrun: boolean }[] = [];
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (window as any).stoppedTracks = 0;
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options);
      stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => {
          (window as any).stoppedTracks++;
          stop();
        };
      });
      return stream;
    };
  });
  await page.routeWebSocket("**/operator", (ws) => {
    ws.send(
      JSON.stringify({
        type: "ready",
        protocolVersion: OPERATOR_PROTOCOL_VERSION,
        transport: "websocket",
        connected: true,
        hasApiKey: true,
        message: "Audio fixture",
      }),
    );
    ws.send(
      JSON.stringify({ type: "session", active: false, behavior: "stopped" }),
    );
    ws.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const message = JSON.parse(raw);
      if (message.type === "start") {
        ws.send(
          JSON.stringify({
            type: "session",
            active: true,
            behavior: "performing",
          }),
        );
        ws.send(
          JSON.stringify({
            type: "audio.start",
            generation: 7,
          }),
        );
        ws.send(
          JSON.stringify({
            type: "audio.chunk",
            generation: 7,
            pcm: Buffer.alloc(24000).toString("base64"),
          }),
        );
      } else if (message.type === "playback") progress.push(message);
      else if (message.type === "stop")
        ws.send(
          JSON.stringify({
            type: "session",
            active: false,
            behavior: "stopped",
          }),
        );
    });
  });
  await page.goto("/");
  await page.getByLabel("Mute microphone", { exact: true }).check();
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect
    .poll(() => progress.some((p) => p.underrun && p.elapsedMs >= 500))
    .toBe(true);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).stoppedTracks))
    .toBeGreaterThan(0);
});

test("plays a burst longer than two seconds continuously and clears immediately on interrupt", async ({
  page,
}) => {
  const progress: {
    generation: number;
    elapsedMs: number;
    queuedMs: number;
    underrun: boolean;
  }[] = [];
  const faults: string[] = [];
  await page.routeWebSocket("**/operator", (ws) => {
    ws.send(
      JSON.stringify({
        type: "ready",
        protocolVersion: OPERATOR_PROTOCOL_VERSION,
        transport: "websocket",
        connected: true,
        hasApiKey: true,
        message: "Audio fixture",
      }),
    );
    ws.send(
      JSON.stringify({ type: "session", active: false, behavior: "stopped" }),
    );
    ws.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const message = JSON.parse(raw);
      if (message.type === "start") {
        ws.send(
          JSON.stringify({
            type: "session",
            active: true,
            behavior: "idle/listening",
          }),
        );
        ws.send(JSON.stringify({ type: "audio.start", generation: 7 }));
        ws.send(
          JSON.stringify({
            type: "audio.chunk",
            generation: 7,
            pcm: Buffer.alloc(24000 * 2 * 3).toString("base64"),
          }),
        );
      } else if (message.type === "playback") progress.push(message);
      else if (message.type === "audio.error") faults.push(message.message);
      else if (message.type === "interrupt") {
        ws.send(JSON.stringify({ type: "audio.clear", generation: 8 }));
        ws.send(
          JSON.stringify({
            type: "audio.chunk",
            generation: 7,
            pcm: Buffer.alloc(4800).toString("base64"),
          }),
        );
      } else if (message.type === "stop")
        ws.send(
          JSON.stringify({
            type: "session",
            active: false,
            behavior: "stopped",
          }),
        );
    });
  });
  await page.goto("/");
  await page.getByLabel("Mute microphone", { exact: true }).check();
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect
    .poll(
      () =>
        progress.some(
          (p) => p.generation === 7 && p.elapsedMs >= 2000 && !p.underrun,
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  expect(faults).toEqual([]);
  await page.getByRole("button", { name: "Interrupt response" }).click();
  const elapsedAtInterrupt =
    progress.filter((p) => p.generation === 7).at(-1)?.elapsedMs ?? 0;
  await expect
    .poll(() => {
      const latest = progress.filter((p) => p.generation === 7).at(-1);
      return latest?.elapsedMs ?? 0;
    })
    .toBeLessThan(elapsedAtInterrupt + 80);
  expect(faults).toEqual([]);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
});

test("refuses to start when the operator protocol version does not match", async ({
  page,
}) => {
  await page.routeWebSocket("**/operator", (ws) => {
    ws.send(
      JSON.stringify({
        type: "ready",
        transport: "websocket",
        connected: true,
        hasApiKey: true,
        message: "Stale controller",
      }),
    );
    ws.send(
      JSON.stringify({ type: "session", active: false, behavior: "stopped" }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByText(
      "Controller is out of date. Restart Puppeteer, then reload this page.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start listening" }),
  ).toBeDisabled();
});

test("does not render blank user or assistant transcript rows", async ({
  page,
}) => {
  await page.routeWebSocket("**/operator", (ws) => {
    for (const message of [
      { type: "transcript", role: "user", text: "Hello", final: true },
      {
        type: "transcript",
        role: "assistant",
        text: "Hello there.",
        final: true,
      },
      { type: "transcript", role: "user", text: "", final: true },
      { type: "transcript", role: "user", text: "  ", final: true },
      { type: "transcript", role: "assistant", text: "", final: true },
      { type: "transcript", role: "user", text: "  ", final: false },
    ])
      ws.send(JSON.stringify(message));
  });
  await page.goto("/");
  await expect(page.locator(".transcripts article")).toHaveCount(2);
  await expect(page.locator(".transcripts article.user")).toHaveCount(1);
  await expect(page.locator(".partial")).toHaveCount(0);
});

test("keeps console chrome locked when session data arrives", async ({
  page,
}) => {
  let operator: { send: (raw: string) => void } | undefined;
  await page.routeWebSocket("**/operator", (ws) => {
    operator = ws;
    ws.send(
      JSON.stringify({
        type: "ready",
        protocolVersion: OPERATOR_PROTOCOL_VERSION,
        transport: "websocket",
        connected: true,
        hasApiKey: true,
        message: "Audio fixture",
      }),
    );
    ws.send(
      JSON.stringify({ type: "session", active: false, behavior: "stopped" }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Puppeteer" })).toBeVisible();
  const before = await chromeBox(page);
  const motor = (angleDeg: number, moving = false) => ({
    angleDeg,
    targetDeg: angleDeg,
    speedDegPerSec: 30,
    moving,
  });
  for (const message of [
    { type: "session", active: true, behavior: "idle/listening" },
    {
      type: "robot",
      event: {
        type: "state",
        state: {
          creature: {
            behavior: "idle/listening",
            gesture: "celebrate",
            expression: "happy",
            actionId: "act-1",
            actionStatus: "running",
          },
          motors: {
            baseYaw: motor(12.5, true),
            headPitch: motor(-8.25),
            jawOpen: motor(18.75, true),
          },
          eyes: {
            left: { mode: "parameters", x: 0, y: 0, brightness: 1, openness: 1 },
            right: { mode: "parameters", x: 0, y: 0, brightness: 1, openness: 1 },
          },
        },
      },
    },
    { type: "robot", event: { type: "pending", count: 3 } },
    { type: "playback.metrics", queuedMs: 1840, underrun: true },
    { type: "usage", value: { input: 12, output: 34 } },
    { type: "transcript", role: "user", text: "Hello there Socky", final: true },
    {
      type: "transcript",
      role: "assistant",
      text: "Hi! Want to hear about motors?",
      final: true,
    },
    { type: "transcript", role: "user", text: "Hearing more", final: false },
  ])
    operator!.send(JSON.stringify(message));
  await expect(page.getByText("idle/listening", { exact: true })).toBeVisible();
  await expect(page.locator(".transcripts article")).toHaveCount(3);
  expect(await chromeBox(page)).toEqual(before);
});
