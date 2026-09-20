import { supabase } from '@/integrations/supabase/client';

export async function getAvailableSameDaySlots(currentBookingId: string, targetDate: string) {
  // 1. Fetch all active bookings for that specific date
  const { data: dayBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, slot_time, status')
    .eq('slot_date', targetDate)
    .neq('status', 'cancelled');

  // 2. Fetch the master schedule from time_slots
  const { data: timeSlots, error: slotsError } = await supabase
    .from('time_slots')
    .select('*');

  if (bookingsError || slotsError || !timeSlots) {
    console.error("Error fetching move data", bookingsError, slotsError);
    return [];
  }

  const availableSlots = [];
  const now = new Date();

  for (const slot of timeSlots) {
    // Determine the exact time string (handling potential column name variations)
    const timeString = slot.slot_time;
    if (!timeString) continue;

    // Check 3-hour cutoff rule
    const slotStart = new Date(`${targetDate}T${timeString}`);
    const msUntilStart = slotStart.getTime() - now.getTime();
    const hoursUntilStart = msUntilStart / (1000 * 60 * 60);

    // If it's less than 3 hours away, block it
    if (hoursUntilStart < 3) continue; 

    // Count how many people are already booked at this specific time
    const slotBookings = dayBookings?.filter(b => b.slot_time === timeString) || [];
    
    // Check capacity (defaults to 1 if you don't have a specific capacity column)
    const capacity = slot.max_capacity || 1;
    if (slotBookings.length >= capacity) continue;

    availableSlots.push({
      ...slot,
      exact_time: timeString
    });
  }

  // Return the remaining safe slots sorted chronologically
  return availableSlots.sort((a, b) => a.exact_time.localeCompare(b.exact_time));
}
