import type { LiveEvent, ToolCall } from "./types";
type Event = Record<string, unknown>;
type Work = {
  id: string;
  delegationId: string;
  calls: Set<string>;
  pending: number;
  completed: boolean;
  blocked: boolean;
};
/** Correlates the nested Responses stream. A backend completion is never a playback boundary. */
export class LiveDelegation {
  private epoch = 0;
  private responses = new Map<string, Work>();
  private delegations = new Map<string, { epoch: number; created: number }>();
  private calls = new Set<string>();
  private closed = false;
  constructor(
    private send: (event: unknown) => void,
    private onTool: (call: ToolCall) => Promise<unknown>,
    private emit: (event: LiveEvent) => void,
  ) {}
  invalidate() {
    this.epoch++;
    for (const w of this.responses.values()) w.blocked = true;
  }
  close() {
    this.closed = true;
    this.invalidate();
  }
  handle(event: Event) {
    if (this.closed) return;
    if (event.type === "session.delegation.created") {
      const delegation = event.delegation as Event | undefined;
      const id = String(event.delegation_id ?? delegation?.id ?? "");
      if (id && !this.delegations.has(id)) {
        // New delegated intent supersedes unfinished expressive work.
        this.invalidate();
        this.delegations.set(id, { epoch: this.epoch, created: Date.now() });
        if (this.delegations.size > 1024) {
          this.emit({
            type: "error",
            message: "Live delegation limit reached; restart session",
          });
          return;
        }
        this.emit({ type: "delegation", active: true });
      }
      return;
    }
    const inner = event.event as Event | undefined,
      delegationId = String(event.delegation_id ?? "");
    if (event.type !== "response.event" || !inner || !delegationId) return;
    // A nested stream can arrive before the delegation notification.
    if (!this.delegations.has(delegationId))
      this.delegations.set(delegationId, {
        epoch: this.epoch,
        created: Date.now(),
      });
    const response = inner.response as Event | undefined;
    const responseId = String(inner.response_id ?? response?.id ?? "");
    if (inner.type === "response.created" && responseId) {
      if (!this.responses.has(responseId))
        this.responses.set(responseId, {
          id: responseId,
          delegationId,
          calls: new Set(),
          pending: 0,
          completed: false,
          blocked: this.delegations.get(delegationId)!.epoch !== this.epoch,
        });
      return;
    }
    const work = responseId
      ? this.responses.get(responseId)
      : [...this.responses.values()].find(
          (w) => w.delegationId === delegationId && !w.completed,
        );
    if (!work) return;
    if (inner.type === "response.output_item.done") {
      const item = inner.item as Event | undefined;
      if (
        item?.type !== "function_call" ||
        typeof item.call_id !== "string" ||
        this.calls.has(item.call_id)
      )
        return;
      if (this.calls.size >= 4096) {
        this.emit({
          type: "error",
          message: "Live action limit reached; restart session",
        });
        return;
      }
      this.calls.add(item.call_id);
      work.calls.add(item.call_id);
      work.pending++;
      void this.execute(work, item, item.call_id);
    } else if (
      ["response.completed", "response.failed", "response.incomplete"].includes(
        String(inner.type),
      )
    ) {
      work.completed = true;
      if (inner.type !== "response.completed") work.blocked = true;
      if (response?.usage)
        this.emit({ type: "usage", value: { backend: response.usage } });
      this.finish(work);
    }
  }
  private async execute(work: Work, item: Event, callId: string) {
    const epoch = this.epoch;
    let result: unknown;
    try {
      if (work.blocked) throw new Error("Canceled action");
      if (Date.now() - this.delegations.get(work.delegationId)!.created > 10000)
        throw new Error("Action expired");
      if (item.name !== "puppet_act") throw new Error("Unknown tool");
      if (work.calls.size > 8)
        throw new Error("Too many actions in one response");
      result = await this.onTool({
        delegationId: work.delegationId,
        responseId: work.id,
        callId,
        name: item.name,
        arguments: JSON.parse(String(item.arguments)),
      });
    } catch (error) {
      result = { status: "rejected", message: String(error) };
    }
    work.pending--;
    if (epoch !== this.epoch || work.blocked || this.closed) {
      this.finish(work);
      return;
    }
    this.send({
      type: "response.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.finish(work);
  }
  private finish(work: Work) {
    if (!work.completed || work.pending) return;
    if (!work.blocked && !this.closed) {
      if (work.calls.size) this.send({ type: "response.create" });
      else this.emit({ type: "delegation", active: false });
    }
    this.responses.delete(work.id);
  }
}
