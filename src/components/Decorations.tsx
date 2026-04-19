import { motion } from "framer-motion";

/** Decorative floral SVG element. Use with absolute positioning. */
export function FloralAccent({
  className = "",
  size = 120,
  delay = 0,
  rotate = 0,
}: {
  className?: string;
  size?: number;
  delay?: number;
  rotate?: number;
}) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      initial={{ opacity: 0, scale: 0.6, rotate: rotate - 20 }}
      animate={{ opacity: 0.45, scale: 1, rotate }}
      transition={{ duration: 1.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`pointer-events-none ${className}`}
    >
      <g stroke="hsl(var(--gold))" strokeWidth="0.7" fill="none" opacity="0.85">
        <path d="M100 30 C 115 60, 140 70, 165 60 C 145 90, 145 115, 170 130 C 140 130, 122 150, 122 178 C 110 150, 90 145, 65 152 C 85 130, 85 105, 60 92 C 90 92, 110 65, 100 30 Z" />
        <circle cx="100" cy="105" r="3" fill="hsl(var(--gold))" opacity="0.5" />
        <path d="M100 50 Q 105 75, 100 100" />
        <path d="M100 100 Q 95 125, 100 150" />
      </g>
    </motion.svg>
  );
}

/** Tiny horse silhouette flourish */
export function HorseFlourish({ className = "", size = 80 }: { className?: string; size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 0.6, x: 0 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      className={`pointer-events-none ${className}`}
    >
      <g fill="none" stroke="hsl(var(--gold))" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {/* Stylised horse head */}
        <path d="M30 95 C 30 70, 40 55, 55 50 L 60 35 L 70 30 L 75 40 C 90 45, 95 60, 92 75 L 100 80 L 95 88 L 85 86 C 80 92, 72 95, 65 95 Z" />
        <path d="M62 42 L 65 38" />
        <circle cx="73" cy="55" r="1.5" fill="hsl(var(--gold))" />
        {/* Mane swirl */}
        <path d="M55 50 Q 45 45, 40 55 Q 38 65, 45 70" opacity="0.7" />
      </g>
    </motion.svg>
  );
}
