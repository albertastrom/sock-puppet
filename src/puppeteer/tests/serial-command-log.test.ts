import { describe, expect, it } from "vitest";
import { createSerialCommandRecorder } from "../src/serial-command-log";

describe("serial command log", () => {
  it("brackets tool movement and records sent wire commands", () => {
    const lines: string[] = [];
    const record = createSerialCommandRecorder((line) => lines.push(line));
    record({ type: "action", status: "requested", id: "tool-1" });
    record({
      type: "robot",
      event: {
        type: "wire",
        phase: "sent",
        line: "eye,0,angry",
      },
    });
    record({
      type: "robot",
      event: {
        type: "wire",
        phase: "ack",
        line: "eye,0,angry",
      },
    });
    record({
      type: "robot",
      event: {
        type: "wire",
        phase: "marker",
        line: "END TOOL CALL",
      },
    });
    expect(lines).toEqual([
      "STARTING TOOL CALL",
      "eye,0,angry",
      "END TOOL CALL",
    ]);
  });
});
