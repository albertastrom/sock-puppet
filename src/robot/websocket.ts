import { WebSocket, WebSocketServer } from "ws";
import type { Command } from "@sock-puppet/robot/protocol";
import { BaseRobot } from "./base";
export class WebSocketRobot extends BaseRobot {
  private server?: WebSocketServer;
  private socket?: WebSocket;
  constructor(
    private port = 8787,
    private origins = ["http://localhost:5173", "http://127.0.0.1:5173"],
  ) {
    super();
  }
  async connect() {
    if (this.server) return;
    const server = (this.server = new WebSocketServer({
      host: "127.0.0.1",
      port: this.port,
      maxPayload: 60000,
      verifyClient: ({ origin }: { origin: string }) =>
        !origin || this.origins.includes(origin),
    }));
    server.on("connection", (socket) => {
      if (this.socket) {
        socket.close(1008, "Only one robot may connect");
        return;
      }
      this.socket = socket;
      const handshake = setTimeout(() => {
        if (!this.connected) socket.close(1008, "Handshake timeout");
      }, 3000);
      const pulse = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }, 1000);
      socket.on("pong", () => {
        if (this.socket === socket) this.touch();
      });
      socket.on("message", (data, binary) => {
        if (this.socket !== socket) return;
        try {
          if (binary) throw new Error("JSON required");
          this.receive(JSON.parse(data.toString()));
        } catch {
          socket.close(1008, "Invalid JSON");
        }
      });
      socket.on("close", () => {
        clearTimeout(handshake);
        clearInterval(pulse);
        if (this.socket === socket) {
          this.socket = undefined;
          this.lost("Robot disconnected; resume session after reconnect");
        }
      });
      socket.on("error", () => socket.close());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }
  protected write(command: Command) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("Robot disconnected");
    this.socket.send(JSON.stringify(command));
  }
  protected closeLink() {
    this.socket?.terminate();
  }
  async disconnect() {
    this.closeLink();
    this.socket = undefined;
    this.lost("Robot transport stopped");
    const server = this.server;
    this.server = undefined;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  get portNumber() {
    return (this.server?.address() as { port: number } | undefined)?.port;
  }
}
