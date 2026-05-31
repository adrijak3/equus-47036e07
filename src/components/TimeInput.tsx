import { useEffect, useState } from "react";
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
 * Time input that auto-formats HH:MM as the user types.
 * Typing "1730" -> displays "17:30". Backspace removes a digit at a time.
 */
export function TimeInput({ value, onChange, placeholder = "pvz. 17:30", className, autoFocus, id, ariaLabel }: Props) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const format = (raw: string): string => {
    // Allow only digits and a single ":". User types the colon manually.
    let s = raw.replace(/[^\d:]/g, "");
    // Keep only first colon
    const firstColon = s.indexOf(":");
    if (firstColon !== -1) {
      s = s.slice(0, firstColon + 1) + s.slice(firstColon + 1).replace(/:/g, "");
    }
    // Cap lengths: HH (2) : MM (2)
    if (firstColon === -1) {
      s = s.slice(0, 2);
    } else {
      const [h, m = ""] = s.split(":");
      s = `${h.slice(0, 2)}:${m.slice(0, 2)}`;
    }
    return s;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = format(e.target.value);
    setLocal(formatted);
    onChange(formatted);
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
      autoFocus={autoFocus}
      className={cn("tabular-nums", className)}
      maxLength={5}
    />
  );
}
