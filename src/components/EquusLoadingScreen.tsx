import horseHead from "./equus-head-transparent.png";

export function EquusLoadingScreen() {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background"
      role="status"
      aria-label="EQUUS"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[10%] top-[12%] h-64 w-64 rounded-full bg-primary/[0.09] blur-3xl" />
        <div className="absolute bottom-[8%] right-[8%] h-72 w-72 rounded-full bg-blue-400/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
      </div>

      <div className="relative flex flex-col items-center px-6 text-center">
        <h1 className="equus-title font-display text-6xl font-semibold tracking-[0.24em] text-primary sm:text-8xl">
          EQUUS
        </h1>

        <div className="mt-4 h-px w-40 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />

        <div className="relative mt-10 flex h-64 w-64 items-center justify-center sm:h-72 sm:w-72">
          <div className="equus-halo absolute inset-[12%] rounded-full bg-primary/[0.08] blur-2xl" />

          <div className="equus-logo-wrap relative">
            <img
              src={horseHead}
              alt=""
              draggable={false}
              className="equus-head block w-56 select-none sm:w-64"
            />

            <div className="equus-shimmer pointer-events-none absolute inset-0 overflow-hidden">
              <div className="equus-shimmer-band absolute -left-1/2 top-0 h-full w-1/3 rotate-12 bg-gradient-to-r from-transparent via-white/35 to-transparent blur-sm" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes equus-breathe {
          0%, 100% {
            opacity: 0.2;
            transform: scale(0.96);
            filter:
              brightness(0)
              saturate(100%)
              invert(67%)
              sepia(45%)
              saturate(1200%)
              hue-rotate(180deg)
              brightness(108%)
              contrast(101%)
              drop-shadow(0 0 5px hsl(var(--primary) / 0.18));
          }

          50% {
            opacity: 1;
            transform: scale(1.025);
            filter:
              brightness(0)
              saturate(100%)
              invert(67%)
              sepia(45%)
              saturate(1200%)
              hue-rotate(180deg)
              brightness(108%)
              contrast(101%)
              drop-shadow(0 0 28px hsl(var(--primary) / 0.5));
          }
        }

        @keyframes equus-title-glow {
          0%, 100% {
            opacity: 0.82;
            text-shadow: 0 0 10px hsl(var(--primary) / 0.15);
          }

          50% {
            opacity: 1;
            text-shadow:
              0 0 12px hsl(var(--primary) / 0.24),
              0 0 28px hsl(var(--primary) / 0.12);
          }
        }

        @keyframes equus-shimmer {
          0%, 38% {
            transform: translateX(-180%);
            opacity: 0;
          }

          45% {
            opacity: 0.85;
          }

          62% {
            transform: translateX(420%);
            opacity: 0;
          }

          100% {
            transform: translateX(420%);
            opacity: 0;
          }
        }

        @keyframes equus-halo {
          0%, 100% {
            opacity: 0.35;
            transform: scale(0.94);
          }

          50% {
            opacity: 0.9;
            transform: scale(1.04);
          }
        }

        .equus-title {
          animation: equus-title-glow 2.8s ease-in-out infinite;
        }

        .equus-head {
          animation: equus-breathe 2.5s ease-in-out infinite;
          pointer-events: none;
        }

        .equus-halo {
          animation: equus-halo 2.5s ease-in-out infinite;
        }

        .equus-shimmer-band {
          animation: equus-shimmer 3.8s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .equus-title,
          .equus-head,
          .equus-halo,
          .equus-shimmer-band {
            animation: none !important;
          }

          .equus-head {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
