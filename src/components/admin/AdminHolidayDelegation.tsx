import { useEffect, useState } from "react";
import { CalendarDays, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Person { id: string; full_name: string; }
interface Delegation { delegate_id: string; starts_on: string; ends_on: string; }

export function AdminHolidayDelegation() {
  const { user } = useAuth();
  const [permanent, setPermanent] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [delegateId, setDelegateId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [current, setCurrent] = useState<Delegation | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    const [{ data: owner }, { data: existing }] = await Promise.all([
      (supabase as any).rpc("is_permanent_admin", { _user_id: user.id }),
      (supabase as any).from("admin_holiday_delegations")
        .select("delegate_id,starts_on,ends_on").eq("owner_id", user.id).maybeSingle(),
    ]);
    const allowed = owner === true;
    setPermanent(allowed);
    if (allowed) {
      const { data, error } = await supabase.from("profiles")
        .select("id,full_name").order("full_name");
      if (error) toast.error("Nepavyko įkelti klientų sąrašo.");
      setPeople((data ?? []).filter((p) => p.id !== user.id) as Person[]);
    }
    if (existing) {
      setCurrent(existing);
      setDelegateId(existing.delegate_id);
      setStartsOn(existing.starts_on);
      setEndsOn(existing.ends_on);
    } else {
      setCurrent(null);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]);

  const save = async () => {
    if (!delegateId || !startsOn || !endsOn) {
      toast.error("Pasirinkite žmogų ir atostogų pradžios bei pabaigos datas.");
      return;
    }
    if (endsOn < startsOn) {
      toast.error("Pabaigos data negali būti ankstesnė už pradžią.");
      return;
    }
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("set_admin_holiday_delegation", {
      _delegate_id: delegateId,
      _starts_on: startsOn,
      _ends_on: endsOn,
    });
    setBusy(false);
    if (error || data?.ok !== true) {
      toast.error(error?.message ?? "Nepavyko išsaugoti laikino administratoriaus.");
      return;
    }
    toast.success("Laikinas administratorius išsaugotas. Teisės galios tik nurodytomis dienomis.");
    await load();
  };

  const revoke = async () => {
    if (!window.confirm("Atšaukti laikiną administratoriaus prieigą ir atostogų pranešimą?")) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("set_admin_holiday_delegation", {
      _delegate_id: null, _starts_on: null, _ends_on: null,
    });
    setBusy(false);
    if (error || data?.ok !== true) {
      toast.error(error?.message ?? "Nepavyko atšaukti.");
      return;
    }
    setCurrent(null);
    setDelegateId("");
    setStartsOn("");
    setEndsOn("");
    toast.success("Laikinas administratorius atšauktas.");
  };

  if (loading) return <p className="text-sm text-muted-foreground">Kraunami atostogų nustatymai…</p>;
  if (!permanent) return (
    <p className="text-sm text-muted-foreground">
      Atostogų administratorių paskirti arba pakeisti gali tik nuolatinis administratorius.
    </p>
  );
  const chosen = people.find((p) => p.id === delegateId);
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-gold" /> Laikinas administratorius</div>
      <p className="text-sm text-muted-foreground">
        Pasirinktas žmogus turės administratoriaus teises tik nuo pradžios iki pabaigos dienos (imtinai).
        Jos automatiškai pasibaigs pagal Lietuvos laiką. Tai nepakeis jo nuolatinio vaidmens.
        Pasirinkite tik patikimą žmogų, nes jis galės tvarkyti klientus ir rezervacijas.
      </p>
      <div className="space-y-2">
        <Label htmlFor="holiday-admin">Kas jus pavaduos?</Label>
        <select id="holiday-admin" value={delegateId} onChange={(e) => setDelegateId(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Pasirinkite žmogų</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="holiday-start">Nuo</Label>
          <Input id="holiday-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="holiday-end">Iki (imtinai)</Label>
          <Input id="holiday-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      {delegateId && endsOn && (
        <div className="rounded-xl border border-gold/20 bg-gold/5 p-3 text-sm">
          <CalendarDays className="mr-2 inline h-4 w-4 text-gold" />
          Atostogauju iki {endsOn.split("-").reverse().join(".")} :), dėl klausimų, prašau kreiptis pas {chosen?.full_name?.trim().split(/\s+/)[0] ?? "pasirinktą administratorių"}, ačiū už supratingumą :)
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="gold" disabled={busy || !delegateId || !startsOn || !endsOn} onClick={() => void save()}>
          {busy ? "Saugoma…" : "Išsaugoti atostogas"}
        </Button>
        {current && (
          <Button variant="outline" disabled={busy} onClick={() => void revoke()}>
            <Trash2 className="mr-2 h-4 w-4" /> Atšaukti pavadavimą
          </Button>
        )}
      </div>
      {current && <p className="text-xs text-muted-foreground">
        Dabartinis pavadavimas: {people.find(p => p.id === current.delegate_id)?.full_name ?? "—"} · {current.starts_on} – {current.ends_on}
      </p>}
    </section>
  );
}
