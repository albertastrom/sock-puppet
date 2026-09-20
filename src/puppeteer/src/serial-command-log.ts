import { createWriteStream } from "node:fs";

type ConsoleEvent = {
  type: string;
  [key: string]: unknown;
};

export function createSerialCommandRecorder(write: (line: string) => void) {
  let activeToolCall: string | undefined;
  return (event: ConsoleEvent) => {
    if (event.type === "action") {
      const id = String(event.id);
      if (event.status === "requested") {
        activeToolCall = id;
        write("STARTING TOOL CALL");
      } else if (event.status === "rejected" && activeToolCall === id) {
        write("END TOOL CALL");
        activeToolCall = undefined;
      }
      return;
    }
    if (event.type !== "robot") return;
    const robot = event.event as
      | {
          type?: string;
          phase?: string;
          line?: unknown;
        }
      | undefined;
    if (
      robot?.type === "wire" &&
      robot.phase === "sent" &&
      typeof robot.line === "string"
    ) {
      write(robot.line);
      return;
    }
    if (
      robot?.type === "wire" &&
      robot.phase === "marker" &&
      robot.line === "END TOOL CALL" &&
      activeToolCall
    ) {
      write("END TOOL CALL");
      activeToolCall = undefined;
    }
  };
}

export function createSerialCommandLog(file: string) {
  const stream = createWriteStream(file, { flags: "a" });
  stream.on("error", (error) => {
    console.error(`Serial command log failed: ${error.message}`);
  });
  stream.write(`\n--- ${new Date().toISOString()} ---\n`);
  const record = createSerialCommandRecorder((line) =>
    stream.write(`${line}\n`),
  );
  return {
    record,
    close() {
      return new Promise<void>((resolve) => stream.end(resolve));
    },
  };
}
