import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { z } from "zod";
import { parseCommand } from "@sock-puppet/robot/protocol";
import { WebSocketRobot } from "./robot/websocket";
import { SerialRobot } from "./robot/serial";
import type { RobotClient } from "./robot/types";
import { OpenAILive } from "./providers/openai-live";
import { Session, type ConsoleEvent } from "./harness/session";
const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT ?? 8788),
  robotPort = Number(process.env.ROBOT_WS_PORT ?? 8787);
const origins = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];
let robot: RobotClient;
let session: Session;
let operator: WebSocket | undefined;
let transport =
  process.env.ROBOT_TRANSPORT === "serial" ? "serial" : "websocket";
let connectionMessage = "Waiting for robot";
const emit = (event: ConsoleEvent) => {
  if (event.type === "robot") {
    const e = event.event as { type: string; message?: string };
    if (e.type === "connection") connectionMessage = e.message ?? "";
  }
  if (operator?.readyState !== WebSocket.OPEN) return;
  if (operator.bufferedAmount > 4 * 1024 * 1024) {
    operator.terminate();
    return;
  }
  operator.send(JSON.stringify(event));
};
const providers = new OpenAILive();
function createRobot(
  kind: string,
  serialPath = process.env.SERIAL_PATH ?? "",
  baud = Number(process.env.SERIAL_BAUD ?? 921600),
) {
  return kind === "serial"
    ? new SerialRobot(serialPath, baud)
    : new WebSocketRobot(robotPort, [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        ...(process.env.TWIN_ORIGIN ? [process.env.TWIN_ORIGIN] : []),
      ]);
}
robot = createRobot(transport);
session = new Session(robot, providers, emit);
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  if (
    !req.headers.host ||
    ![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)
  ) {
    res.writeHead(403);
    res.end("Localhost only");
    return;
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        transport,
        connected: robot.connected,
        message: connectionMessage,
        hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      }),
    );
    return;
  }
  try {
    const base = path.join(root, "dist"),
      relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1),
      file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(file);
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(
      "Console not built. Run npm run build, then open this address again.",
    );
  }
});
const wss = new WebSocketServer({
  server,
  path: "/operator",
  maxPayload: 65536,
  verifyClient: ({ origin }: { origin: string }) => origins.includes(origin),
});
const controls = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("motion.stop") }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("history.clear") }),
  z.object({ type: z.literal("ports") }),
  z.object({
    type: z.literal("transport"),
    transport: z.enum(["websocket", "serial"]),
    path: z.string().max(512).optional(),
    baud: z.number().int().min(9600).max(3000000).optional(),
  }),
  z.object({ type: z.literal("command"), command: z.unknown() }),
  z.object({
    type: z.literal("playback"),
    generation: z.number().int(),
    elapsedMs: z.number().finite().min(0),
    rms: z.number().min(0).max(1),
    queuedMs: z.number().min(0).max(2000),
    underrun: z.boolean(),
  }),
  z.object({ type: z.literal("audio.error"), message: z.string().max(1000) }),
]);
let switching = false;
wss.on("connection", (socket) => {
  if (operator) {
    socket.close(1008, "An operator console is already connected");
    return;
  }
  operator = socket;
  emit({
    type: "ready",
    robotUrl: `ws://127.0.0.1:${robotPort}`,
    transport,
    connected: robot.connected,
    capabilities: robot.getCapabilities(),
    state: robot.getState(),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    message: connectionMessage,
  });
  emit({
    type: "session",
    active: session.active,
    behavior: session.scheduler.behavior,
  });
  socket.on("message", async (data, binary) => {
    if (operator !== socket) return;
    try {
      if (binary) {
        const pcm = Buffer.from(data as Buffer);
        if (pcm.length > 9600 || pcm.length % 2)
          throw new Error("Expected at most 200ms PCM16 mono at 24kHz");
        session.input(pcm);
        return;
      }
      const msg = controls.parse(JSON.parse(data.toString()));
      if (msg.type === "motion.stop") {
        session.stop(false);
        return;
      }
      if (msg.type === "stop") {
        session.stop();
        return;
      }
      if (msg.type === "interrupt") {
        session.interrupt();
        return;
      }
      if (switching) throw new Error("Transport switch in progress");
      switch (msg.type) {
        case "start":
          await session.start();
          break;
        case "history.clear":
          session.resetHistory();
          break;
        case "ports":
          emit({ type: "ports", ports: await SerialPort.list() });
          break;
        case "playback":
          session.playback(
            msg.generation,
            msg.elapsedMs,
            msg.rms,
            msg.queuedMs,
            msg.underrun,
          );
          break;
        case "audio.error":
          session.fault(msg.message);
          break;
        case "command":
          if (session.active)
            throw new Error("Stop the session before manual control");
          emit({
            type: "manual.result",
            result: await robot.applyCommand(parseCommand(msg.command)),
          });
          break;
        case "transport": {
          if (msg.transport === "serial" && !msg.path)
            throw new Error("Select a serial port");
          switching = true;
          try {
            await session.dispose();
            await robot.disconnect();
            transport = msg.transport;
            robot = createRobot(transport, msg.path, msg.baud);
            session = new Session(robot, providers, emit);
            await robot.connect();
            emit({
              type: "ready",
              robotUrl: `ws://127.0.0.1:${robotPort}`,
              transport,
              connected: robot.connected,
              state: robot.getState(),
              hasApiKey: Boolean(process.env.OPENAI_API_KEY),
              message: "Waiting for fresh robot handshake",
            });
          } finally {
            switching = false;
          }
          break;
        }
      }
    } catch (error) {
      emit({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  socket.on("error", () => socket.close());
  socket.on("close", () => {
    if (operator === socket) {
      operator = undefined;
      session.stop();
    }
  });
  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const pulse = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 5000);
  socket.on("close", () => clearInterval(pulse));
});
await robot.connect();
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Puppeteer console http://127.0.0.1:${port} · twin ws://127.0.0.1:${robotPort}`,
  ),
);
async function shutdown() {
  await session.dispose();
  operator?.terminate();
  await robot.disconnect();
  wss.close();
  server.close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
