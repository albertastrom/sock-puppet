import { useEffect, useRef } from "react";
import { config } from "@sock-puppet/robot/config";
import { paintEye } from "@sock-puppet/robot/display";
import type { Eye } from "@sock-puppet/robot/protocol";

const { width, height } = config.display;

export function EyePreview({ eye }: { eye: Eye }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintEye(ref.current, eye);
  }, [eye]);
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className="eye-preview"
      aria-label={`${width} by ${height} OLED framebuffer preview`}
    />
  );
}
