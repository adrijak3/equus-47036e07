import { supabase } from '@/integrations/supabase/client';

export async function previewRecurringTimeChange(riderId: string, oldTime: string, newTime: string, trainerName: string) {
  // Fetch only future bookings for this specific rider
  const { data: affectedBookings, error } = await supabase
    .from('bookings')
    .select('id, slot_date, slot_time, trainer_name')
    .eq('user_id', riderId)
    .gte('slot_date', new Date().toISOString().split('T')[0])
    .neq('status', 'cancelled');

  if (error || !affectedBookings) {
    console.error("Klaida gaunant treniruotes:", error);
    return [];
  }

  // Filter exactly by the old time and trainer name
  const filtered = affectedBookings.filter(b => 
    b.slot_time === oldTime && 
    b.trainer_name === trainerName
  );

  // Return the clean preview data
  return filtered.map(b => ({
    booking_id: b.id,
    date: b.slot_date,
    current_time: oldTime,
    new_time: newTime
  }));
}
