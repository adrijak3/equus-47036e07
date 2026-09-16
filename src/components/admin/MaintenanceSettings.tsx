import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Construction, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin setting: "Techninis atnaujinimas".
 * Toggles the global maintenance_mode flag in the backend `site_settings` table.
 * Admins are never blocked by maintenance mode themselves.
 */
export function MaintenanceSettings() {
  const [mode, setMode] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("site_settings")
        .select("maintenance_mode")
        .eq("id", 1)
        .maybeSingle();
      setMode(Boolean(data?.maintenance_mode));
    })();
  }, []);

  const setMaintenanceMode = async (next: boolean) => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("site_settings")
      .update({ maintenance_mode: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setSaving(false);
    if (error) {
      toast.error("Nepavyko pakeisti būsenos: " + error.message);
      return;
    }
    setMode(next);
    if (next) toast.success("Techninis atnaujinimas įjungtas. Lankytojai dabar mato atnaujinimo ekraną.");
    else toast.success("Techninis atnaujinimas išjungtas. Svetainė vėl prieinama visiems.");
  };

  const handleToggle = (checked: boolean) => {
    if (checked) {
      // Enabling blocks visitors — ask for confirmation first.
      setConfirmOpen(true);
    } else {
      setMaintenanceMode(false);
    }
  };

  return (
    <Card className="bg-gradient-card border-gold/15 shadow-elegant max-w-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-display">
          <Construction className="w-5 h-5 text-gold" />
          Techninis atnaujinimas
          {mode !== null && (
            <Badge
              className={cn(
                "ml-auto whitespace-nowrap",
                mode ? "bg-blush/20 text-blush border border-blush/40" : "bg-green-500/15 text-green-600 border border-green-500/40",
              )}
            >
              {mode ? "Įjungta" : "Išjungta"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-gold/70" />
          Įjungus šį režimą, lankytojai matys techninio atnaujinimo ekraną.
          Administratoriai galės toliau naudotis svetaine.
        </p>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-gold/15 bg-background/40 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Būsena</p>
            <p className="text-xs text-muted-foreground">
              {mode === null ? "Tikrinama…" : mode ? "Lankytojams rodomas atnaujinimo ekranas" : "Svetainė veikia įprastai"}
            </p>
          </div>
          <Switch
            checked={!!mode}
            onCheckedChange={handleToggle}
            disabled={mode === null || saving}
            aria-label="Įjungti techninį atnaujinimą"
          />
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Įjungti techninį atnaujinimą?</AlertDialogTitle>
            <AlertDialogDescription>
              Lankytojai bus laikinai neleidžiami naudotis įprasta svetaine ir matys
              atnaujinimo ekraną. Jūs, kaip administratorius, galėsite toliau naudotis
              svetaine ir bet kada tai išjungti. Jūs nebusite perkeltas iš šio puslapio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Atšaukti</AlertDialogCancel>
            <AlertDialogAction
              className="bg-blush hover:bg-blush/90 text-white"
              onClick={() => setMaintenanceMode(true)}
            >
              Įjungti
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
