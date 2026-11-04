import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HolidayContact {
  delegate_name: string;
  ends_on: string;
}

export function useHolidayContact() {
  // undefined = not checked yet; avoid flashing a hidden phone number.
  const [holiday, setHoliday] = useState<HolidayContact | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await (supabase as any).rpc("get_public_admin_holiday_contact");
      if (!alive) return;
      if (error) {
        setFailed(true);
        setHoliday(null);
      } else {
        setFailed(false);
        setHoliday((Array.isArray(data) ? data[0] : data) ?? null);
      }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  return { holiday, hidden: holiday === undefined || !!holiday || failed };
}

export function holidayContactText(holiday: HolidayContact) {
  const until = holiday.ends_on.split("-").reverse().join(".");
  return `Atostogauju iki ${until} :), dėl klausimų, prašau kreiptis pas ${holiday.delegate_name}, ačiū už supratingumą :)`;
}
