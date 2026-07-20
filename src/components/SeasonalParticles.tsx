import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useEquusTheme } from "@/contexts/ThemeContext";

const symbols = { spring: "🌸", summer: "✨", autumn: "🍁", winter: "❄" } as const;

export function SeasonalParticles() {
  const { resolvedTheme } = useEquusTheme();
  const location = useLocation();
  const particles = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    id: i, left: `${(i * 37) % 100}%`, delay: `${(i * 0.63) % 8}s`, duration: `${8 + (i % 5) * 1.7}s`, size: `${12 + (i % 4) * 4}px`,
  })), []);
  if (location.pathname !== "/paskyra") return null;
  return <div className="seasonal-particles" aria-hidden="true">{particles.map(p => <span key={p.id} style={{ left:p.left, animationDelay:p.delay, animationDuration:p.duration, fontSize:p.size }}>{symbols[resolvedTheme]}</span>)}</div>;
}
