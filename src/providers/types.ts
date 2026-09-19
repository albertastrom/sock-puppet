import type { Capabilities } from "../robot/types";
import type { State } from "@sock-puppet/robot/simulator";
export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type Transcript = { text: string; final: boolean; key?: string };
export type SpeechChunk = {
  pcm: Buffer;
};
export interface Transcriber {
  send(pcm: Buffer): void;
  finalize(): void;
  close(): void;
}
export interface VoiceProvider {
  transcribe(
    onTranscript: (event: Transcript) => void,
    onError: (error: Error) => void,
  ): Promise<Transcriber>;
  speak(
    text: string,
    signal: AbortSignal,
    onChunk: (chunk: SpeechChunk) => void,
  ): Promise<void>;
}
export interface PerformancePlanner {
  plan(
    history: HistoryMessage[],
    capabilities: Capabilities,
    state: State,
    signal: AbortSignal,
    repair?: string,
  ): Promise<unknown>;
}
export interface Providers {
  voice: VoiceProvider;
  planner: PerformancePlanner;
}
