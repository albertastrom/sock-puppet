import assert from "node:assert/strict";
import { SerialRobot } from "../src/robot/serial";
const robot = new SerialRobot(
  process.argv[2],
  Number(process.argv[3] ?? 921600),
);
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("PTY condition timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
try {
  await robot.connect();
  await until(() => robot.connected);
  const result = await robot.applyCommand({
    version: 1,
    type: "command",
    id: "pty-move",
    motors: { baseYaw: { angleDeg: 20, speedDegPerSec: 60 } },
  });
  assert.equal(result.type, "ack");
  await until(() => robot.getState()?.motors.baseYaw.angleDeg === 20);
  const frame = {
    mode: "pixels" as const,
    data: Buffer.alloc(1024, 75).toString("base64"),
    brightness: 0.6,
  };
  assert.equal(
    (
      await robot.applyCommand({
        version: 1,
        type: "command",
        id: "pty-pixels",
        eyes: { left: frame, right: frame },
      })
    ).type,
    "ack",
  );
  await until(() => robot.getState()?.eyes.left.mode === "pixels");
  assert.deepEqual(robot.getState()?.eyes.right, frame);
  assert.equal(
    (
      await robot.applyCommand({
        version: 1,
        type: "command",
        id: "invalid",
        motors: { headPitch: { angleDeg: 100 } },
      })
    ).type,
    "error",
  );
  await robot.disconnect();
  await robot.connect();
  await until(() => robot.connected);
  assert.equal(robot.getState()?.motors.baseYaw.moving, false);
  console.log(
    "PTY serial smoke passed: native port, fragmented frames, motion, pixels, validation, reconnect",
  );
} finally {
  await robot.disconnect();
}
