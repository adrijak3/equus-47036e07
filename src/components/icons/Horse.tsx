import { CSSProperties } from "react";

/**
 * Horse icon — uses a PNG asset rendered as currentColor via CSS mask,
 * so it themes like Lucide icons.
 */
export function Horse({ size = 18, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/horse-icon.png)",
        maskImage: "url(/horse-icon.png)",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}
