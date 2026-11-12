import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HolidayContact {
  delegate_name: string;
  ends_on: string;
}

// Cache the same public holiday lookup across simultaneous hook instances.
// The one-minute TTL retains fast vacation-contact privacy updates.
let sharedHolidayRequest: Promise<{data: unknown;error: unknown}> | null = null;
let holidayRequestAt = 0;
const loadSharedHoliday = () => {
  if (!sharedHolidayRequest || Date.now() - holidayRequestAt > 55_000) {
    holidayRequestAt = Date.now();
    sharedHolidayRequest = (supabase as any).rpc("get_public_admin_holiday_contact").then(
      ({data,error}: {data:unknown;error:unknown}) => ({data,error}),
      (error:unknown) => ({data:null,error}),
    );
  }
  return sharedHolidayRequest;
};

export function useHolidayContact() {
  // undefined = not checked yet; avoid flashing a hidden phone number.
  const [holiday, setHoliday] = useState<HolidayContact | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await loadSharedHoliday();
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
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, []);

  return { holiday, hidden: holiday === undefined || !!holiday || failed };
}

export function holidayContactText(holiday: HolidayContact) {
  const until = holiday.ends_on.split("-").reverse().join(".");
  return `Atostogauju iki ${until} :), dėl klausimų, prašau kreiptis pas ${holiday.delegate_name}, ačiū už supratingumą :)`;
}
