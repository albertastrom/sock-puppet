export type LiveEvent =
  | { type: "audio"; pcm: Buffer }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "delegation"; active: boolean }
  | { type: "usage"; value: unknown }
  | { type: "error"; message: string };
export type ToolCall = {
  delegationId: string;
  responseId: string;
  callId: string;
  name: string;
  arguments: unknown;
};
export interface LiveConnection {
  send(pcm: Buffer): void;
  interrupt(): void;
  close(): Promise<void>;
}
export interface LiveProvider {
  connect(
    onEvent: (event: LiveEvent) => void,
    onTool: (call: ToolCall) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<LiveConnection>;
}
