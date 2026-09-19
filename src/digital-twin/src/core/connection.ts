import { Simulator } from "@sock-puppet/robot/simulator";
import {
  capabilitiesMessage,
  errorResult,
  stateMessage,
  type Result,
  type State,
  type WireMessage,
} from "@sock-puppet/robot/protocol";

export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export class Connection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private telemetry?: ReturnType<typeof setInterval>;
  private active = false;
  private attempt = 0;
  private generation = 0;
  private previousEyes?: State["eyes"];
  private onVisibility?: () => void;
  constructor(
    private simulator: Simulator,
    private onStatus: (status: ConnectionStatus) => void,
    private onEvent: (message: string, result?: Result) => void,
    private factory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}
  connect(url: string) {
    const parsed = new URL(url);
    if (!["ws:", "wss:"].includes(parsed.protocol))
      throw new Error("Use a ws:// or wss:// URL");
    this.disconnect();
    this.active = true;
    this.attempt = 0;
    this.open(url, this.generation);
  }
  private open(url: string, generation: number) {
    if (!this.active || generation !== this.generation) return;
    this.onStatus(this.attempt ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try {
      socket = this.factory(url);
    } catch {
      this.retry(url, generation);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.attempt = 0;
      this.onStatus("connected");
      this.onEvent("Controller connected");
      const state = this.simulator.getState();
      this.send(capabilitiesMessage(state));
      this.previousEyes = state.eyes;
      const publish = () => {
        const next = this.simulator.getState();
        this.send(stateMessage(next, this.previousEyes));
        this.previousEyes = next.eyes;
      };
      this.telemetry = setInterval(publish, 50);
      if (typeof document !== "undefined") {
        this.onVisibility = () => {
          if (document.visibilityState === "visible") publish();
        };
        document.addEventListener("visibilitychange", this.onVisibility);
      }
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation || !this.active) return;
      let raw: unknown;
      let result: Result;
      try {
        if (typeof event.data !== "string" || event.data.length > 60000)
          throw new Error("Expected JSON text of at most 60,000 characters");
        raw = JSON.parse(event.data);
        result = this.simulator.applyCommand(raw);
      } catch (error) {
        result = errorResult(raw, error);
      }
      this.send(result);
      this.onEvent(
        result.type === "ack" ? `Accepted ${result.id}` : result.message,
        result,
      );
    };
    socket.onerror = () => {
      this.onEvent("WebSocket error");
      socket.close();
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      this.stopTelemetry();
      this.simulator.freeze();
      this.onEvent("Connection lost · pose frozen");
      this.retry(url, generation);
    };
  }
  private retry(url: string, generation: number) {
    if (!this.active || generation !== this.generation) return;
    this.onStatus("reconnecting");
    const delay = Math.min(1000 * 2 ** this.attempt++, 10000);
    this.timer = setTimeout(() => this.open(url, generation), delay);
  }
  private send(message: WireMessage) {
    if (this.socket?.readyState === 1)
      this.socket.send(JSON.stringify(message));
  }
  disconnect() {
    this.active = false;
    this.generation++;
    this.previousEyes = undefined;
    clearTimeout(this.timer);
    this.stopTelemetry();
    this.socket?.close();
    this.socket = undefined;
    this.simulator.freeze();
    this.onStatus("disconnected");
  }
  private stopTelemetry() {
    clearInterval(this.telemetry);
    this.telemetry = undefined;
    if (this.onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onVisibility = undefined;
    }
  }
}
