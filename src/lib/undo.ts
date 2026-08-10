import { toast } from "sonner";

/**
 * Shows a destructive-action toast with a real, reversible "undo" action.
 * The database write already happened; undoFn performs the inverse write.
 */
export function toastUndo(message: string, undoFn: () => Promise<void> | void, seconds = 8) {
  toast.success(message, {
    duration: seconds * 1000,
    action: {
      label: `ATŠAUKTI VEIKSMĄ · ${seconds} s.`,
      onClick: () => {
        void (async () => {
          try {
            await undoFn();
            toast.success("Veiksmas atšauktas");
          } catch (e: any) {
            toast.error(`Nepavyko atšaukti veiksmo: ${e?.message ?? e}`);
          }
        })();
      },
    },
  });
}