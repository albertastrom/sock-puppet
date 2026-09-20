import { test, expect } from "@playwright/test";
import { WebSocketServer } from "ws";
test("manual controls, independent eyes, console validation, and neutral reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Virtual Socky" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hello" }).click();
  await expect(page.getByTestId("jawOpen-actual")).toHaveText("30.0°");
  const target = page.getByLabel("Base rotation target");
  await target.fill("");
  await target.pressSequentially("-25");
  await target.press("Enter");
  await expect(page.getByTestId("baseYaw-actual")).toHaveText("-25.0°");
  await page.getByLabel("Pupil X", { exact: true }).fill("20");
  await page.getByRole("button", { name: "right eye" }).click();
  await expect(page.getByLabel("Pupil X", { exact: true })).toHaveValue("32");
  await page.getByRole("tab", { name: "Command console" }).click();
  await page.getByLabel("JSON command").fill(
    JSON.stringify({
      version: 2,
      type: "command",
      id: "browser",
      motors: { headPitch: { angleDeg: -45 }, jawOpen: { angleDeg: 45 } },
    }),
  );
  await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.locator("output")).toHaveText("Accepted browser");
  await page.getByLabel("JSON command").fill("{invalid");
  await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.locator("output")).toContainText("Invalid JSON");
  await page.getByRole("tab", { name: "Manual controls" }).click();
  await expect(page.getByTestId("headPitch-actual")).toHaveText("-45.0°");
  await page.screenshot({
    path: "test-results/joint-extremes.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Neutral" }).click();
  await expect(page.getByTestId("jawOpen-actual")).toHaveText("0.0°");
  await page.screenshot({ path: "test-results/neutral.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("external commands lock manual controls and disconnection freezes", async ({
  page,
}) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "capabilities")
        socket.send(
          JSON.stringify({
            version: 2,
            type: "command",
            id: "external",
            motors: { baseYaw: { angleDeg: 90, speedDegPerSec: 5 } },
          }),
        );
    });
  });
  try {
    await page.goto("/");
    await page
      .getByLabel("WebSocket URL")
      .fill(`ws://127.0.0.1:${address.port}`);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hello" })).toBeDisabled();
    await expect(page.getByLabel("Event log")).toContainText(
      "Accepted external",
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hello" })).toBeEnabled();
    const target = Number(
      await page.getByLabel("Base rotation target").inputValue(),
    );
    expect(target).toBeLessThan(90);
    await page.waitForTimeout(250);
    expect(
      Number(
        await page
          .getByTestId("baseYaw-actual")
          .innerText()
          .then((t) => t.replace("°", "")),
      ),
    ).toBeCloseTo(target, 0);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("mobile viewport remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Virtual Socky" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("renders the remaining joint extremes and monochrome frame orientation", async ({
  page,
}) => {
  await page.goto("/");
  for (const [yaw, pitch] of [
    [90, 45],
    [-90, -45],
  ]) {
    await page.getByRole("tab", { name: "Command console" }).click();
    await page.getByLabel("JSON command").fill(
      JSON.stringify({
        version: 2,
        type: "command",
        id: `extreme-${yaw}`,
        motors: {
          baseYaw: { angleDeg: yaw },
          headPitch: { angleDeg: pitch },
          jawOpen: { angleDeg: 45 },
        },
      }),
    );
    await page.getByRole("button", { name: "Send command" }).click();
    await page.getByRole("tab", { name: "Manual controls" }).click();
    await expect(page.getByTestId("baseYaw-actual")).toHaveText(
      `${yaw.toFixed(1)}°`,
      { timeout: 15000 },
    );
    await expect(page.getByTestId("headPitch-actual")).toHaveText(
      `${pitch.toFixed(1)}°`,
    );
    await page.screenshot({ path: `test-results/extreme-${yaw}.png` });
  }
  const frame = Buffer.alloc(1024);
  frame[0] = 128;
  frame[1023] = 1;
  await page.getByRole("tab", { name: "Command console" }).click();
  await page.getByLabel("JSON command").fill(
    JSON.stringify({
      version: 2,
      type: "command",
      id: "frame",
      motors: {
        baseYaw: { angleDeg: 0 },
        headPitch: { angleDeg: 0 },
        jawOpen: { angleDeg: 0 },
      },
      eyes: {
        left: {
          mode: "pixels",
          data: frame.toString("base64"),
          brightness: 1,
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Send command" }).click();
  await page.getByRole("tab", { name: "Manual controls" }).click();
  await expect(page.getByTestId("baseYaw-actual")).toHaveText("0.0°");
  const samples = await page
    .locator(".eye-preview")
    .first()
    .evaluate((element) => {
      const ctx = (element as HTMLCanvasElement).getContext("2d")!;
      return [
        Array.from(ctx.getImageData(0, 0, 1, 1).data),
        Array.from(ctx.getImageData(63, 127, 1, 1).data),
      ];
    });
  expect(samples).toEqual([
    [255, 255, 255, 255],
    [255, 255, 255, 255],
  ]);
  await page.screenshot({ path: "test-results/pixel-frame.png" });
});

test("rejects unsafe speed, selects symbols independently, and stops motion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Eye display").selectOption("heart");
  await expect(page.getByLabel("Pupil X", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "right eye" }).click();
  await expect(page.getByLabel("Eye display")).toHaveValue("parameters");
  await expect(page.locator(".eye-preview").first()).toHaveAttribute(
    "width",
    "64",
  );
  await expect(page.locator(".eye-preview").first()).toHaveAttribute(
    "height",
    "128",
  );
  await page.getByRole("tab", { name: "Command console" }).click();
  await page.getByLabel("JSON command").fill(
    JSON.stringify({
      version: 2,
      type: "command",
      id: "unsafe",
      motors: { headPitch: { angleDeg: 10, speedDegPerSec: 61 } },
    }),
  );
  await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.locator("output")).toContainText("between 1 and 60");
  await page.getByRole("tab", { name: "Manual controls" }).click();
  await page.getByLabel("Base rotation speed").fill("5");
  await page.getByLabel("Base rotation speed").press("Enter");
  await page.getByLabel("Base rotation target").fill("90");
  await page.getByLabel("Base rotation target").press("Enter");
  await page.getByRole("button", { name: "Stop motion" }).click();
  const held = await page.getByTestId("baseYaw-actual").textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("baseYaw-actual")).toHaveText(held!);
});

test("previews portrait expressions and autonomous gestures offline", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start idle", exact: true }).click();
  await expect(page.locator(".panel-content")).toContainText("idle/listening");
  await page.getByLabel("Expression", { exact: true }).selectOption("wink");
  await expect(page.locator(".panel-content")).toContainText("wink");
  await page.screenshot({ path: "test-results/portrait-wink.png" });
  await page.getByRole("button", { name: "nod", exact: true }).click();
  await expect(page.locator(".panel-content")).toContainText("nod");
  await page
    .getByRole("button", { name: "Pause creature", exact: true })
    .click();
  await expect(page.locator(".panel-content")).toContainText("stopped");
  await page.getByLabel("Eye sequence", { exact: true }).selectOption("boot");
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-results/portrait-boot.png" });
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + box.width * 0.35,
      box.y + box.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
  }
  await page.screenshot({ path: "test-results/striped-rear.png" });
});
