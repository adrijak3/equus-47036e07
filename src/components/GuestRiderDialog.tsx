import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface GuestRiderLite {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  is_newcomer: boolean;
}

/**
 * Small dialog used by admin/trainer to add a guest ("naujokė") rider to a slot.
 * Lets them search existing guest_riders (reuse) or create a brand-new one.
 */
export function GuestRiderDialog({
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (riderId: string, displayName: string, isNewcomer: boolean) => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [existing, setExisting] = useState<GuestRiderLite[]>([]);
  const [selected, setSelected] = useState<GuestRiderLite | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setFirstName(""); setLastName(""); setPhone(""); setSelected(null);
    setLoadingList(true);
    supabase
      .from("guest_riders")
      .select("id, first_name, last_name, phone, is_newcomer")
      .order("last_name")
      .then(({ data }) => {
        setExisting((data ?? []) as GuestRiderLite[]);
        setLoadingList(false);
      });
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return existing.slice(0, 8);
    return existing
      .filter((g) => `${g.first_name} ${g.last_name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [existing, query]);

  const canCreate = firstName.trim().length >= 2 && lastName.trim().length >= 1;

  const handleConfirm = async () => {
    if (selected) {
      onConfirm(selected.id, `${selected.first_name} ${selected.last_name}`.trim(), selected.is_newcomer);
      return;
    }
    if (!canCreate) { toast.error("Įveskite vardą ir pavardę"); return; }
    const { data: userRes } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("guest_riders")
      .insert({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
        is_newcomer: true,
        created_by: userRes.user?.id ?? null,
      })
      .select("id, first_name, last_name, phone, is_newcomer")
      .single();
    if (error || !data) { toast.error(error?.message ?? "Klaida"); return; }
    onConfirm(data.id, `${data.first_name} ${data.last_name}`.trim(), data.is_newcomer);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-gradient-gold">Pridėti naujokę (svečią)</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Suraskite jau esamą svečią arba sukurkite naują.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ieškoti esamo svečio</Label>
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Vardas ar pavardė..."
              className="mt-1.5"
            />
            {!loadingList && filtered.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-auto space-y-1">
                {filtered.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(g)}
                      className={`w-full text-left rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        selected?.id === g.id
                          ? "border-gold bg-gold/10 text-foreground"
                          : "border-gold/15 hover:border-gold/40 hover:bg-gold/5 text-foreground/85"
                      }`}
                    >
                      {g.first_name} {g.last_name}
                      {g.is_newcomer && <span className="ml-1.5 text-[10px] text-gold/70">(naujokė)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!selected && (
            <div className="pt-3 border-t border-gold/10 space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Arba sukurti naują</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Vardas" maxLength={40} />
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Pavardė" maxLength={40} />
              </div>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefonas (nebūtina)" maxLength={30} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Atgal</Button>
          <Button
            variant="gold"
            disabled={busy || (!selected && !canCreate)}
            onClick={handleConfirm}
          >
            Pridėti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
