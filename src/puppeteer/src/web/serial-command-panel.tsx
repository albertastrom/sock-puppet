type SerialCommandPanelProps = {
  commands: string[];
};

export function SerialCommandPanel({
  commands,
}: SerialCommandPanelProps) {
  return (
    <section className="card mt-4" aria-label="Recent serial commands">
      <div className="section-heading mb-2 flex items-center justify-between">
        <h3 className="text-[15px] font-medium">Recent serial commands</h3>
        <span className="text-[11px] text-mute">Newest last</span>
      </div>
      <pre className="max-h-40 min-h-16 overflow-auto whitespace-pre-wrap break-all rounded-md bg-oat p-3 font-mono text-[12px] leading-relaxed">
        {commands.length ? commands.join("\n") : "No commands sent"}
      </pre>
    </section>
  );
}
