import { MotionConfig } from "framer-motion";
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  const userIdRef = useRef<string | null>(null);

  const setEffectsEnabled = (enabled: boolean) => {
    setEffectsEnabledState(enabled);
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
    const uid = userIdRef.current;
    if (uid) {
      void supabase.from("profiles").update({ reduced_effects: !enabled }).eq("id", uid);
    }
  };

  useEffect(() => {
    const hydrate = async (uid: string) => {
      userIdRef.current = uid;
      const { data } = await supabase
        .from("profiles")
        .select("reduced_effects")
        .eq("id", uid)
        .maybeSingle();
      if (data && typeof data.reduced_effects === "boolean") {
        const enabled = !data.reduced_effects;
        setEffectsEnabledState(enabled);
        window.localStorage.setItem(STORAGE_KEY, String(enabled));
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      if (uid) setTimeout(() => void hydrate(uid), 0);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (uid) void hydrate(uid);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

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
