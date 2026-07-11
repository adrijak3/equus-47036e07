import horseHead from "@/assets/equus-head-transparent.png";

export function EquusLoadingScreen() {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background"
      role="status"
      aria-label="EQUUS"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[12%] top-[14%] h-56 w-56 rounded-full bg-primary/[0.08] blur-3xl" />
        <div className="absolute bottom-[10%] right-[10%] h-64 w-64 rounded-full bg-blue-400/[0.05] blur-3xl" />
      </div>

      <div className="relative flex flex-col items-center text-center">
        <h1 className="font-display text-6xl font-semibold tracking-[0.24em] text-primary sm:text-8xl">
          EQUUS
        </h1>

        <div className="mt-4 h-px w-40 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />

        <img
          src={horseHead}
          alt=""
          draggable={false}
          className="equus-head mt-10 w-56 select-none sm:w-64"
        />
      </div>

      <style>{`
        @keyframes equus-head-fade {
          0%, 100% {
            opacity: 0.18;
            transform: scale(0.96);
            filter: drop-shadow(0 0 4px hsl(var(--primary) / 0.15));
          }

          50% {
            opacity: 1;
            transform: scale(1.02);
            filter: drop-shadow(0 0 24px hsl(var(--primary) / 0.45));
          }
        }

        .equus-head {
          animation: equus-head-fade 2.4s ease-in-out infinite;
          filter:
            brightness(0)
            saturate(100%)
            invert(67%)
            sepia(45%)
            saturate(1200%)
            hue-rotate(180deg)
            brightness(108%)
            contrast(101%);
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .equus-head {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
