import { MotionConfig } from "framer-motion";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "equus_effects_enabled";

interface EffectsContextValue {
  effectsEnabled: boolean;
  setEffectsEnabled: (enabled: boolean) => void;
}

const EffectsContext = createContext<EffectsContextValue | undefined>(undefined);

function initialEffectsEnabled() {
  if (typeof window === "undefined") return true;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "true") return true;
  if (saved === "false") return false;

  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function EffectsProvider({ children }: { children: ReactNode }) {
  const [effectsEnabled, setEffectsEnabledState] = useState(initialEffectsEnabled);

  const setEffectsEnabled = (enabled: boolean) => {
    setEffectsEnabledState(enabled);
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  };

  useEffect(() => {
    document.documentElement.dataset.effects = effectsEnabled ? "on" : "off";
  }, [effectsEnabled]);

  return (
    <EffectsContext.Provider value={{ effectsEnabled, setEffectsEnabled }}>
      <MotionConfig reducedMotion={effectsEnabled ? "never" : "always"}>
        {children}
      </MotionConfig>
    </EffectsContext.Provider>
  );
}

export function useEffects() {
  const value = useContext(EffectsContext);
  if (!value) throw new Error("useEffects must be used inside EffectsProvider");
  return value;
}
