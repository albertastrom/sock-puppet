import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em]",
  {
    variants: {
      tone: {
        mute: "bg-oat text-mute",
        live: "bg-glow-soft text-glow-ink",
        ok: "bg-[#edf5ee] text-[#24673a]",
        wait: "bg-[#f7f0e4] text-[#78510c]",
        pink: "bg-pink-soft text-rose",
      },
    },
    defaultVariants: { tone: "mute" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
