import { test, expect } from "@playwright/test";
test("controls the actual twin through the puppeteer WebSocket and survives reconnect", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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
  await page
    .getByLabel("Robot command JSON")
    .fill(
      JSON.stringify({
        version: 1,
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
  const progress: { elapsedMs: number; done: boolean }[] = [];
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
            segment: 0,
            text: "Audio fixture",
            minDurationMs: 500,
          }),
        );
        ws.send(
          JSON.stringify({
            type: "audio.chunk",
            generation: 7,
            segment: 0,
            pcm: Buffer.alloc(24000).toString("base64"),
          }),
        );
        ws.send(
          JSON.stringify({ type: "audio.end", generation: 7, segment: 0 }),
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
    .poll(() => progress.some((p) => p.done && p.elapsedMs >= 500))
    .toBe(true);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).stoppedTracks))
    .toBeGreaterThan(0);
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
