export interface MinimalGuestRider {
  first_name: string;
  last_name: string;
  is_newcomer: boolean;
}

/** Prefers the linked guest_riders record; falls back to legacy booking.guest_name. */
export function guestDisplayName(guest?: MinimalGuestRider | null, legacyName?: string | null) {
  if (guest) return `${guest.first_name} ${guest.last_name}`.trim();
  return legacyName ?? "Svečias";
}
