import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Notice = {
  id: string;
  title_lt: string; title_en: string;
  body_lt: string; body_en: string;
  read_at: string | null; created_at: string;
  url: string | null;
};

export default function NotificationInbox() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const [rows, unread] = await Promise.all([
      (supabase as any).from("important_notifications")
        .select("id,title_lt,title_en,body_lt,body_en,read_at,created_at,url")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(60),
      (supabase as any).from("important_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id).is("read_at", null),
    ]);
    if (!rows.error) setItems((rows.data || []) as Notice[]);
    if (!unread.error) setUnreadCount(unread.count || 0);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) { setItems([]); setUnreadCount(0); return; }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3 * 60_000);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [user?.id, refresh]);

  const markRead = async (ids: string[]) => {
    if (!user || !ids.length) return;
    setLoading(true);
    const { error } = await (supabase as any).from("important_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).in("id", ids);
    if (!error) await refresh();
    setLoading(false);
  };
  if (!user) return null;
  const lt = language === "lt";

  return <>
    <button
      type="button"
      aria-label={lt ? `Pranešimai, neperskaityta: ${unreadCount}` : `Notifications, unread: ${unreadCount}`}
      aria-haspopup="dialog"
      onClick={() => { void refresh(); setOpen(true); }}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 text-foreground transition-colors hover:bg-muted/50"
    >
      <Bell className="h-5 w-5"/>
      {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground" aria-hidden="true">{unreadCount>99?"99+":unreadCount}</span>}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[82vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5"/>{lt?"Mano pranešimai":"My notifications"}
            {unreadCount>0 && <span className="text-sm font-normal text-muted-foreground">({unreadCount} {lt?"neperskaityta":"unread"})</span>}
          </DialogTitle>
        </DialogHeader>
        {unreadCount > 0 && <Button variant="outline" size="sm" className="self-start" disabled={loading} onClick={() => void markRead(items.filter(n=>!n.read_at).map(n=>n.id))}>
          <CheckCheck className="mr-2 h-4 w-4"/>{lt?"Pažymėti kaip perskaitytus":"Mark all as read"}
        </Button>}
        <div className="max-h-[55vh] divide-y divide-border/60 overflow-y-auto">
          {items.length===0 && <p className="py-7 text-center text-sm text-muted-foreground">{lt?"Pranešimų dar nėra.":"No notifications yet."}</p>}
          {items.map(n=><article key={n.id} className={`space-y-2 py-4 ${!n.read_at?"font-medium":""}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm">{lt?n.title_lt:n.title_en}</p>
              {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" aria-label="Neperskaityta"/>}
            </div>
            <p className="whitespace-pre-wrap text-sm font-normal text-muted-foreground">{lt?n.body_lt:n.body_en}</p>
            <p className="text-xs font-normal text-muted-foreground">{new Date(n.created_at).toLocaleString(lt?"lt-LT":"en-US")}</p>
            <div className="flex gap-3 text-xs font-normal">
              {n.url?.startsWith("/") && !n.url.startsWith("//") && <Link to={n.url} className="font-medium text-gold underline underline-offset-2" onClick={() => {setOpen(false); if(!n.read_at)void markRead([n.id]);}}>{lt?"Peržiūrėti":"Open"}</Link>}
              {!n.read_at && <button className="text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={loading} onClick={() => void markRead([n.id])}>{lt?"Perskaityta":"Mark read"}</button>}
            </div>
          </article>)}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
