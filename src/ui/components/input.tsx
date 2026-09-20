import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full min-w-0 rounded-md border-[1.5px] border-knit bg-paper px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] placeholder:text-mute focus-visible:border-pink focus-visible:shadow-[0_0_0_4px_var(--color-pink-soft)] disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
