/** Opt-in paid test. An optional file contains prerecorded mono PCM16LE/24kHz; no microphone recording. */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { OpenAILive } from "../src/providers/openai-live";
import { Simulator } from "@sock-puppet/robot/simulator";
import { parsePuppetAct } from "@sock-puppet/robot/actions";
const provider = new OpenAILive(),
  simulator = new Simulator();
let outputBytes = 0,
  tools = 0;
try {
  const live = await provider.connect(
    (event) => {
      if (event.type === "error") console.error(event.message);
      if (event.type === "usage")
        console.log("Usage:", JSON.stringify(event.value));
      if (event.type === "audio") outputBytes += event.pcm.length;
      if (event.type === "transcript")
        console.log(`${event.role}: ${event.text}`);
    },
    async (call) => {
      tools++;
      const work = parsePuppetAct(call.arguments);
      const result = simulator.applyCommand({
        version: 2,
        type: "command",
        id: call.callId,
        creature: work,
      });
      console.log("Simulated action:", JSON.stringify(work));
      return { status: result.type === "ack" ? "accepted" : "rejected" };
    },
  );
  console.log("GPT Live session ready");
  try {
    const pcm = process.argv[2]
      ? await readFile(process.argv[2])
      : Buffer.alloc(48000);
    if (pcm.length % 2)
      throw new Error("PCM file must contain complete 16-bit samples");
    const duration = pcm.length + (process.argv[2] ? 48000 * 12 : 0);
    for (let offset = 0; offset < duration; offset += 4800) {
      live.send(
        offset < pcm.length
          ? pcm.subarray(offset, offset + 4800)
          : Buffer.alloc(4800),
      );
      for (let i = 0; i < 5; i++) simulator.step(0.02);
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await live.close();
  }
  console.log(JSON.stringify({ outputAudioMs: outputBytes / 48, tools }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
