import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCircle2, Download, Smartphone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { enablePushNotifications, getPushConnectionStatus, pushNotificationsSupported } from "@/lib/pushNotifications";
import { isIOS, isStandalone, promptInstall, useInstallState } from "@/lib/install";
import { useLanguage } from "@/contexts/LanguageContext";
import EffectsToggle from "@/components/EffectsToggle";

const steps = {
  ios: [
    "Atidarykite Equus svetainę savo iPhone per Safari (iOS 16.4 ar naujesnė).",
    "Paspauskite bendrinimo mygtuką (Share), tada „Įtraukti į pagrindinį ekraną“ (Add to Home Screen).",
    "Patvirtinkite „Įtraukti“ ir paleiskite Equus iš pagrindinio ekrano, ne Safari skirtuko.",
    "Prisijunkite prie Equus, paspauskite „Įjungti pranešimus“ ir suteikite leidimą.",
  ],
  android: [
    "Atidarykite Equus per Chrome arba Edge telefone.",
    "Naršyklės meniu (⋮) pasirinkite „Įdiegti programėlę“ arba „Pridėti prie pagrindinio ekrano“.",
    "Patvirtinkite įdiegimą. Equus bus galima atidaryti kaip atskirą programėlę.",
    "Prisijunkite, paspauskite „Įjungti pranešimus“ ir patvirtinkite Android leidimą.",
  ],
  desktop: [
    "Chrome arba Edge naršyklėje atidarykite Equus.",
    "Adreso juostoje ieškokite diegimo piktogramos arba meniu pasirinkite „Įdiegti šią svetainę kaip programėlę“.",
    "Po įdiegimo atidarykite Equus ir suteikite leidimą pranešimams.",
  ],
};

export default function AppInstallGuide() {
  const { language } = useLanguage();
  const { isAdmin } = useAuth();
  const { canInstall, installed } = useInstallState();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected" | "blocked" | "unsupported">("checking");
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">(() => {
    if (isIOS()) return "ios";
    if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) return "android";
    return "desktop";
  });
  const lt = language === "lt";

  const refresh = async () => {
    try { setStatus(await getPushConnectionStatus()); }
    catch { setStatus("disconnected"); }
  };
  useEffect(() => { void refresh(); }, []);

  const install = async () => {
    if (!canInstall) return;
    setBusy(true);
    try {
      const result = await promptInstall();
      if (result === "accepted") toast.success("Equus įdiegimas patvirtintas.");
    } catch { toast.error("Nepavyko atidaryti diegimo lango."); }
    finally { setBusy(false); }
  };
  const enable = async () => {
    setBusy(true);
    try {
      await enablePushNotifications(language);
      await refresh();
      toast.success("Pranešimai įjungti šiame įrenginyje.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nepavyko įjungti pranešimų.");
      await refresh();
    } finally { setBusy(false); }
  };
  const testServerDelivery = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("push-notifications", {
        body: { action: "test" },
      });
      if (error || !data?.ok || !(Number(data?.delivered) > 0)) {
        throw new Error(data?.error || data?.code || error?.message || "Serverio testas nepavyko.");
      }
      toast.success("Serverio bandomasis pranešimas išsiųstas į Jūsų prijungtus įrenginius.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nepavyko išsiųsti serverio pranešimo.");
    } finally { setTesting(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      if (!pushNotificationsSupported() || Notification.permission !== "granted") {
        toast.error("Pirmiausia įjunkite telefono pranešimus.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Equus – bandomasis pranešimas", {
        body: "Puiku! Šiame įrenginyje galite matyti Equus pranešimus.",
        icon: "/equus-icon-192.png",
        badge: "/equus-icon-192.png",
        tag: "equus-local-test",
        data: { url: "/grafikas" },
      });
      toast.success("Bandomasis pranešimas parodytas šiame įrenginyje.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nepavyko parodyti bandomojo pranešimo.");
    } finally { setTesting(false); }
  };

  return <main className="container max-w-3xl py-8 sm:py-12">
    <div className="flex items-center gap-3">
      <img src="/equus-icon-192.png" width={64} height={64} className="h-14 w-14 rounded-2xl border border-border/50" alt="Equus programėlės piktograma" />
      <div><p className="text-xs uppercase tracking-wider text-muted-foreground">EQUUS JOJIMO MOKYKLA</p>
        <h1 className="font-display text-3xl">Įsidiegti Equus</h1></div>
    </div>
    <p className="mt-4 text-sm text-muted-foreground">Patogus grafikas, registracijos ir pranešimai tiesiai telefone. Tai ta pati Equus svetainė, įdiegta pagrindiniame ekrane.</p>

    <section className="mt-7 space-y-4 rounded-xl border border-border/70 p-5">
      <div className="flex items-center gap-2"><Download className="h-5 w-5 text-gold"/><h2 className="font-semibold">1. Įdiekite programėlę</h2></div>
      {installed || isStandalone()
        ? <p className="inline-flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-500"/> Equus jau atidaryta kaip programėlė.</p>
        : canInstall
          ? <Button onClick={() => void install()} disabled={busy}><Download className="mr-2 h-4 w-4"/> Įdiegti Equus</Button>
          : <p className="text-sm text-muted-foreground">Jei automatinio diegimo mygtuko nėra, naudokite savo naršyklės meniu pagal instrukcijas žemiau. Įdiegimo pasiūlymą valdo naršyklė.</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pasirinkite įrenginį">
        {([["ios","iPhone / Safari"],["android","Android / Chrome / Edge"],["desktop","Kompiuteris"]] as const).map(([key,label]) =>
          <Button key={key} variant={platform===key?"default":"outline"} size="sm" onClick={()=>setPlatform(key)}>{label}</Button>)}
      </div>
      <ol className="space-y-3 text-sm">
        {steps[platform].map((step,index)=><li key={index} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{index+1}</span><span>{step}</span>
        </li>)}
      </ol>
      <details className="border-t border-border/60 pt-3 text-sm">
        <summary className="cursor-pointer font-medium">Kitos naršyklės (Brave, Chrome iPhone, Edge iPhone)</summary>
        <p className="mt-2 text-muted-foreground">Brave ir kitos Android naršyklės gali turėti „Įdiegti“ arba „Pridėti prie pradžios ekrano“ pasirinkimą savo meniu. Funkcijos priklauso nuo naršyklės versijos. iPhone patikimiausia Equus pridėti į pagrindinį ekraną per Safari; pranešimus įjunkite jau paleistoje programėlėje.</p>
      </details>
    </section>

    <section className="mt-4 space-y-3 rounded-xl border border-border/70 p-5">
      <div className="flex items-center gap-2"><Bell className="h-5 w-5 text-gold"/><h2 className="font-semibold">2. Įjunkite telefono pranešimus</h2></div>
      <p className="text-sm text-muted-foreground">Leidimą suteiksite naršyklės arba telefono iššokančiame lange. Pranešimai pasirenkami ir juos galite išjungti bet kada.</p>
      <p className="text-sm">{status==="connected"?"Šis įrenginys prijungtas.":status==="blocked"?"Pranešimai užblokuoti naršyklės nustatymuose.":status==="unsupported"?"Šiame naršyklės lange pranešimai nepalaikomi.":status==="checking"?"Tikrinama…":"Pranešimai dar neįjungti šiame įrenginyje."}</p>
      {status!=="connected" && <Button disabled={busy || status==="checking" || !pushNotificationsSupported()} onClick={()=>void enable()}><Bell className="mr-2 h-4 w-4"/> Įjungti pranešimus</Button>}
      {status==="unsupported" && platform==="ios" && <p className="text-xs text-muted-foreground">iPhone: pirmiausia įsidiekite Equus į pagrindinį ekraną, atidarykite iš piktogramos ir bandykite dar kartą.</p>}
      {status==="blocked" && <p className="text-xs text-muted-foreground">Atverkite naršyklės svetainės leidimus arba telefono nustatymus, leiskite Equus pranešimus ir perkraukite puslapį.</p>}
    </section>

    <section className="mt-4 space-y-3 rounded-xl border border-border/70 p-5">
      <div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-gold"/><h2 className="font-semibold">3. Išbandykite pranešimą</h2></div>
      <p className="text-sm text-muted-foreground">Paspauskite mygtuką ir patikrinkite, ar jūsų telefone pasirodo bandomasis Equus pranešimas.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={testing || status!=="connected"} onClick={()=>void test()}>{testing?"Tikrinama…":"Išbandyti šiame įrenginyje"}</Button>
        {isAdmin && <Button disabled={testing || status!=="connected"} onClick={()=>void testServerDelivery()}>{testing?"Siunčiama…":"Išbandyti tikrą serverio pranešimą (admin)"}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Jeigu pranešimas nepasirodo, patikrinkite telefono „Notifications“, „Do Not Disturb“ bei konkrečios naršyklės / Equus leidimus.</p>
    </section>
    <section className="mt-4 space-y-3 rounded-xl border border-border/70 p-5">
      <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-gold"/><h2 className="font-semibold">Kiti nustatymai</h2></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Sumažinti skraidančias animacijas</p><EffectsToggle/></div>
      <Link to="/paskyra" className="inline-block text-sm text-gold underline underline-offset-4">Grįžti į paskyrą</Link>
    </section>
  </main>;
}
