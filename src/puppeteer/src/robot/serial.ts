import { SerialPort } from "serialport";
import type { Duplex } from "node:stream";
import type { Command } from "@sock-puppet/robot/protocol";
import { BaseRobot } from "./base";
import { JsonLines } from "./lines";
export type SerialFactory = () => Duplex;
export class SerialRobot extends BaseRobot {
  private stream?: Duplex;
  private active = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private helloRetry?: ReturnType<typeof setInterval>;
  constructor(
    private path: string,
    private baudRate = 921600,
    private factory?: SerialFactory,
  ) {
    super();
    this.ioTimeoutMs = Math.max(
      3000,
      Math.ceil((2 * 60000 * 10000) / baudRate) + 1000,
    );
  }
  async connect() {
    if (this.active) return;
    this.active = true;
    this.open();
  }
  private open() {
    if (!this.active) return;
    const stream = (this.stream =
      this.factory?.() ??
      new SerialPort({ path: this.path, baudRate: this.baudRate }));
    const parser = new JsonLines(
      (raw) => {
        if (this.stream !== stream) return;
        // A reopened device may still be publishing the previous session's telemetry.
        if (
          !this.connected &&
          (raw as { type?: string })?.type !== "capabilities"
        )
          return;
        this.receive(raw);
        if (this.connected) {
          this.attempts = 0;
          clearTimeout(this.handshake);
          clearInterval(this.helloRetry);
        }
      },
      (message) => {
        this.lost(message);
        this.closeLink();
      },
    );
    stream.on("data", (data) => {
      if (this.stream === stream) parser.push(Buffer.from(data));
    });
    let started = false;
    const begin = () => {
      if (started || this.stream !== stream) return;
      started = true;
      const hello = () => {
        if (!this.connected && this.stream === stream && !stream.destroyed)
          stream.write('{"version":2,"type":"hello"}\n');
      };
      hello();
      this.helloRetry = setInterval(
        hello,
        Math.max(3000, Math.ceil((60000 * 10000) / this.baudRate) + 1000),
      );
      this.handshake = setTimeout(
        () => {
          if (!this.connected) {
            this.lost("Serial handshake timeout");
            this.closeLink();
          }
        },
        Math.max(10000, this.ioTimeoutMs),
      );
      this.heartbeat = setInterval(() => {
        if (!stream.destroyed && stream.writableLength < 1024)
          stream.write('{"version":2,"type":"heartbeat"}\n');
      }, 250);
    };
    if (this.factory) queueMicrotask(begin);
    else stream.once("open", begin);
    stream.on("error", (e) => {
      if (this.stream !== stream) return;
      this.lost(`Serial error: ${e.message}`);
      void this.release(stream);
    });
    stream.on("close", () => {
      if (this.stream !== stream) return;
      clearInterval(this.heartbeat);
      clearTimeout(this.handshake);
      clearInterval(this.helloRetry);
      parser.reset();
      this.stream = undefined;
      this.lost("Serial disconnected; resume after reconnect");
      if (this.active)
        this.retry = setTimeout(
          () => this.open(),
          Math.min(1000 * 2 ** this.attempts++, 10000),
        );
    });
  }
  protected write(command: Command) {
    if (!this.stream || this.stream.destroyed)
      throw new Error("Serial disconnected");
    this.stream.write(JSON.stringify(command) + "\n");
  }
  private async release(stream: Duplex) {
    if (stream instanceof SerialPort) {
      if (stream.opening)
        await new Promise<void>((resolve) => {
          const finished = () => {
            stream.off("open", finished);
            stream.off("error", finished);
            resolve();
          };
          stream.once("open", finished);
          stream.once("error", finished);
        });
      if (stream.isOpen)
        await new Promise<void>((resolve) => stream.close(() => resolve()));
    }
    stream.destroy();
  }
  protected closeLink() {
    if (this.stream) void this.release(this.stream);
  }
  async disconnect() {
    this.active = false;
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    clearInterval(this.helloRetry);
    clearInterval(this.heartbeat);
    const stream = this.stream;
    this.stream = undefined;
    this.lost("Serial transport stopped");
    if (stream) await this.release(stream);
  }
}
