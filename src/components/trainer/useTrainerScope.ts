import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Resolves which `time_slots.trainer_name` value(s) belong to the signed-in trainer,
 * so lesson lists can be scoped to only her own lessons. Admins may switch between
 * all known trainer names.
 */
export function useTrainerScope() {
  const { user, isAdmin } = useAuth();
  const [trainers, setTrainers] = useState<string[]>([]);
  const [trainer, setTrainer] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: ts }, { data: prof }] = await Promise.all([
        supabase.from("time_slots").select("trainer_name").not("trainer_name", "is", null),
        user ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      const names = Array.from(new Set((ts ?? []).map((t: any) => t.trainer_name).filter(Boolean))).sort() as string[];
      setTrainers(names);
      const mine = (prof as any)?.full_name?.split(" ")[0]?.toLowerCase();
      const match = names.find((n) => n.toLowerCase().includes(mine ?? "\u0000"));
      setTrainer(match ?? names[0] ?? "");
      setReady(true);
    })();
  }, [user?.id]);

  return { trainer, setTrainer, trainers, isAdmin, ready };
}
