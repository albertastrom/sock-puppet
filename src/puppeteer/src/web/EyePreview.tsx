import { useEffect, useRef } from "react";
import { config } from "@sock-puppet/robot/config";
import { paintEye } from "@sock-puppet/robot/display";
import type { Eye } from "@sock-puppet/robot/protocol";

export function EyePreview({ eye, name }: { eye: Eye; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintEye(ref.current, eye);
  }, [eye]);
  return (
    <figure className="m-0">
      <canvas
        aria-label={`${name} eye`}
        className="eye-preview"
        ref={ref}
        width={config.display.width}
        height={config.display.height}
      />
      <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        {name}
      </figcaption>
    </figure>
  );
}
