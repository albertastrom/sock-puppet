import { WebSocket, WebSocketServer } from "ws";
import type { Command } from "@sock-puppet/robot/protocol";
import { BaseRobot } from "./base";

const loopbackHosts = ["127.0.0.1", "::1"] as const;

export class WebSocketRobot extends BaseRobot {
  private servers: WebSocketServer[] = [];
  private socket?: WebSocket;
  constructor(
    private port = 8787,
    private origins = [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ],
  ) {
    super();
  }
  async connect() {
    if (this.servers.length) return;
    for (const host of loopbackHosts) {
      let server: WebSocketServer | undefined;
      try {
        server = new WebSocketServer({
          host,
          port: this.port,
          maxPayload: 60000,
          verifyClient: ({ origin }: { origin: string }) =>
            !origin || this.origins.includes(origin),
        });
        this.attach(server);
        await new Promise<void>((resolve, reject) => {
          server!.once("listening", resolve);
          server!.once("error", reject);
        });
        this.servers.push(server);
      } catch (error) {
        server?.close();
        if (host === "127.0.0.1") throw error;
      }
    }
  }
  private attach(server: WebSocketServer) {
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
    const servers = this.servers;
    this.servers = [];
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }
  get portNumber() {
    return (
      this.servers[0]?.address() as { port: number } | undefined
    )?.port;
  }
}
