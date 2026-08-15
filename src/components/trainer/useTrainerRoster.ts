import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { levelOf, type RidingLevel } from "@/lib/levels";

export interface GuestRiderRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_newcomer: boolean;
  linked_user_id: string | null;
}

export interface RosterRow {
  id: string;
  rider_user_id: string | null;
  guest_rider_id: string | null;
  level: RidingLevel;
  note: string | null;
  name: string;
  guest?: GuestRiderRow;
}

/** `${'u'|'g'}:${id}` key used to resolve a rider's roster level anywhere in the trainer area. */
export function riderKey(userId?: string | null, guestId?: string | null) {
  if (userId) return `u:${userId}`;
  if (guestId) return `g:${guestId}`;
  return null;
}

/** The signed-in trainer's own roster (`trainer_riders`). Riders outside it default to 'beginner'. */
export function useTrainerRoster() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [byKey, setByKey] = useState<Record<string, RosterRow>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setRows([]); setByKey({}); setLoading(false); return; }
    setLoading(true);
    const { data: tr, error } = await supabase
      .from("trainer_riders")
      .select("*")
      .eq("trainer_user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) {
      setLoading(false);
      return;
    }
    const list = (tr ?? []) as any[];
    const userIds = list.filter((r) => r.rider_user_id).map((r) => r.rider_user_id as string);
    const guestIds = list.filter((r) => r.guest_rider_id).map((r) => r.guest_rider_id as string);

    const [{ data: profs }, { data: guests }] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
      guestIds.length ? supabase.from("guest_riders").select("*").in("id", guestIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const profMap = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name as string]));
    const guestMap = Object.fromEntries((guests ?? []).map((g: any) => [g.id, g as GuestRiderRow]));

    const built: RosterRow[] = list.map((r) => {
      const guest = r.guest_rider_id ? guestMap[r.guest_rider_id] : undefined;
      const name = r.rider_user_id
        ? profMap[r.rider_user_id] ?? "—"
        : guest ? `${guest.first_name} ${guest.last_name}`.trim() : "—";
      return {
        id: r.id,
        rider_user_id: r.rider_user_id,
        guest_rider_id: r.guest_rider_id,
        level: levelOf(r.level),
        note: r.note,
        name,
        guest,
      };
    });
    built.sort((a, b) => a.name.localeCompare(b.name, "lt"));
    setRows(built);
    setByKey(Object.fromEntries(
      built.map((r) => [riderKey(r.rider_user_id, r.guest_rider_id) as string, r])
    ));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const levelFor = useCallback((userId?: string | null, guestId?: string | null): RidingLevel => {
    const key = riderKey(userId, guestId);
    if (!key) return "beginner";
    return byKey[key]?.level ?? "beginner";
  }, [byKey]);

  return { rows, byKey, loading, reload: load, levelFor };
}
