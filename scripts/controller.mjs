import { WebSocketServer } from "ws";
import readline from "node:readline";
const server = new WebSocketServer({
  host: "127.0.0.1",
  port: 8787,
  maxPayload: 100000,
});
let sequence = 0;
server.on("listening", () =>
  console.log(
    "Controller fixture: ws://localhost:8787\nConnect the twin, then enter hello, neutral, pixels, drop, or a JSON command. No commands are sent automatically.",
  ),
);
server.on("connection", (socket) => {
  console.log("Twin connected");
  let lastMotion = "";
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== "state") console.log(JSON.stringify(message));
    else {
      const motion = Object.values(message.motors)
        .map((m) => m.moving)
        .join();
      if (motion !== lastMotion) {
        console.log("Motion:", message.motors);
        lastMotion = motion;
      }
    }
  });
  socket.on("close", () => console.log("Twin disconnected"));
});
const input = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
input.on("line", (line) => {
  let command;
  if (line === "drop") {
    for (const client of server.clients) client.close();
    return;
  }
  if (line === "hello" || line === "neutral") {
    const neutral = line === "neutral";
    command = {
      version: 1,
      type: "command",
      id: `fixture-${++sequence}`,
      motors: {
        baseYaw: { angleDeg: neutral ? 0 : 25, speedDegPerSec: 25 },
        headPitch: { angleDeg: neutral ? 0 : 15 },
        jawOpen: { angleDeg: neutral ? 0 : 30 },
      },
    };
  } else if (line === "pixels") {
    const frame = Buffer.alloc(19200);
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 80; x++) {
        const i = (y * 80 + x) * 3;
        frame[i] = Math.round((x / 79) * 255);
        frame[i + 1] = Math.round((y / 79) * 255);
        frame[i + 2] = 80;
      }
    command = {
      version: 1,
      type: "command",
      id: `pixels-${++sequence}`,
      eyes: {
        left: { mode: "pixels", data: frame.toString("base64"), brightness: 1 },
      },
    };
  } else {
    try {
      command = JSON.parse(line);
    } catch {
      console.log("Use hello, neutral, pixels, drop, or valid JSON.");
      return;
    }
  }
  if (!server.clients.size) console.log("No twin connected.");
  for (const client of server.clients)
    if (client.readyState === 1) client.send(JSON.stringify(command));
});
