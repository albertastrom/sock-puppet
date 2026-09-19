/** Bounded NDJSON parser. Discards an oversized frame up to its newline. */
export class JsonLines {
  private buffer = Buffer.alloc(0);
  private discarding = false;
  constructor(
    private onMessage: (v: unknown) => void,
    private onError: (message: string) => void,
    private max = 60000,
  ) {}
  push(chunk: Buffer) {
    for (let offset = 0; offset < chunk.length;) {
      const end = chunk.indexOf(10, offset);
      const stop = end < 0 ? chunk.length : end;
      if (!this.discarding) {
        if (this.buffer.length + stop - offset > this.max) {
          this.buffer = Buffer.alloc(0);
          this.discarding = true;
          this.onError("Frame exceeds 60,000 bytes");
        } else
          this.buffer = Buffer.concat([
            this.buffer,
            chunk.subarray(offset, stop),
          ]);
      }
      if (end >= 0) {
        if (!this.discarding && this.buffer.length) {
          try {
            this.onMessage(JSON.parse(this.buffer.toString("utf8")));
          } catch {
            this.onError("Malformed JSON");
          }
        }
        this.buffer = Buffer.alloc(0);
        this.discarding = false;
      }
      offset = end < 0 ? chunk.length : end + 1;
    }
  }
  reset() {
    this.buffer = Buffer.alloc(0);
    this.discarding = false;
  }
}
