import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-40 w-full rounded-md border-[1.5px] border-knit bg-paper p-3 font-mono text-xs leading-relaxed outline-none focus-visible:border-pink focus-visible:shadow-[0_0_0_4px_var(--color-pink-soft)] disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
