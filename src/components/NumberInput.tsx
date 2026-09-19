import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onCommit: (value: number) => void;
};
/** Keep intermediate typing (including an empty field or minus sign) out of the command stream. */
export function NumberInput({ value, onCommit, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...props}
      type="number"
      step="any"
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const text = event.currentTarget.value;
        setDraft(null);
        if (
          text !== "" &&
          Number.isFinite(Number(text)) &&
          Number(text) !== value
        )
          onCommit(Number(text));
      }}
    />
  );
}
