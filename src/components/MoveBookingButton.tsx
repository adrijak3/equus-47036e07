import { useState } from 'react';
import { getAvailableSameDaySlots } from '@/lib/moveTraining';
import { Button } from '@/components/ui/button';

export function MoveBookingButton({ booking }: { booking: any }) {
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  const handleCheckSlots = async () => {
    setIsChecking(true);
    const safeSlots = await getAvailableSameDaySlots(booking.id, booking.slot_date);
    setAvailableSlots(safeSlots);
    setHasChecked(true);
    setIsChecking(false);
  };

  return (
    <div className="flex flex-col gap-3 mt-2 w-full">
      <Button 
        onClick={handleCheckSlots} 
        disabled={isChecking}
        variant="outline"
        className="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200"
      >
        {isChecking ? 'Ieškoma laiko...' : 'Perkelti šios dienos treniruotę'}
      </Button>

      {hasChecked && availableSlots.length > 0 && (
        <div className="p-3 bg-white border border-gray-200 rounded-md shadow-sm">
          <p className="text-sm font-medium mb-2 text-gray-700">Pasirinkite naują laiką šiandien:</p>
          <div className="flex gap-2 flex-wrap">
            {availableSlots.map(slot => (
              <Button key={slot.id} variant="default" size="sm" className="bg-amber-600 hover:bg-amber-700">
                {slot.exact_time}
              </Button>
            ))}
          </div>
        </div>
      )}

      {hasChecked && availableSlots.length === 0 && (
        <p className="text-sm text-red-600 bg-red-50 p-2 rounded-md">
          Šiandien daugiau laisvų vietų nėra.
        </p>
      )}
    </div>
  );
}
