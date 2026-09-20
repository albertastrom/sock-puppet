import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-rose text-white hover:bg-[#A83D4E] disabled:bg-oat disabled:text-mute disabled:opacity-100",
        ink: "bg-ink text-white hover:bg-[#1a1615] disabled:bg-knit disabled:text-white disabled:opacity-100",
        ghost:
          "bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--color-knit)] hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)]",
        live: "bg-glow-soft text-glow-ink",
        stop: "bg-paper text-rose shadow-[inset_0_0_0_1.5px_#e3b4b8] hover:bg-pink-soft",
        quiet: "bg-oat text-ink hover:bg-[#e4d8d2]",
      },
      size: {
        default: "h-11 px-5 text-[15px]",
        sm: "h-9 px-3.5 text-[13px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "size-11",
        pill: "h-12 px-5 text-[14px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: Props) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
