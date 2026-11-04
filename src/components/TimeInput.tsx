import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  id?: string;
  ariaLabel?: string;
}

/**
 * A numeric HH:MM editor. Typing 1730 produces 17:30;
 * the colon appears automatically after the second digit.
 * Pasting 17:30 (or 1730) also works.
 */
export function TimeInput({
  value,
  onChange,
  placeholder = "pvz. 17:30",
  className,
  autoFocus,
  id,
  ariaLabel,
}: Props) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const format = (raw: string): string => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (digits.length < 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  const update = (raw: string) => {
    const formatted = format(raw);
    setLocal(formatted);
    onChange(formatted);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    update(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Backspace at "17:" should remove the hour digit rather than
    // repeatedly recreating the separator.
    const input = event.currentTarget;
    if (
      event.key === "Backspace" &&
      /^\d{2}:$/.test(local) &&
      input.selectionStart === 3 &&
      input.selectionEnd === 3
    ) {
      event.preventDefault();
      update(local.slice(0, 1));
    }
  };

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      autoFocus={autoFocus}
      className={cn("tabular-nums", className)}
      maxLength={5}
    />
  );
}
