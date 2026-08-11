/**
 * PWA install coordination.
 * The `beforeinstallprompt` event fires very early (often before React mounts),
 * so it is captured at module level and shared with the UI through a store.
 */
import { useSyncExternalStore } from "react";

const DISMISS_KEY = "equus_install_dismissed_at";
const DISMISS_DAYS = 30;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

export function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function rememberDismissal() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  emit();
}

/** Must run as early as possible (before React renders). */
export function initInstallCapture() {
  if (typeof window === "undefined") return;
  installed = isStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", () => {
    installed = isStandalone();
    emit();
  });
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const evt = deferred;
  deferred = null;
  emit();
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  if (outcome === "dismissed") rememberDismissal();
  return outcome;
}

interface InstallState {
  canInstall: boolean;
  installed: boolean;
  iosInstructions: boolean;
  dismissed: boolean;
}

let snapshot: InstallState = {
  canInstall: false,
  installed: false,
  iosInstructions: false,
  dismissed: false,
};

function computeSnapshot(): InstallState {
  const std = installed || isStandalone();
  const next: InstallState = {
    canInstall: !!deferred && !std,
    installed: std,
    iosInstructions: !std && isIOS() && !deferred,
    dismissed: wasRecentlyDismissed(),
  };
  if (
    next.canInstall !== snapshot.canInstall ||
    next.installed !== snapshot.installed ||
    next.iosInstructions !== snapshot.iosInstructions ||
    next.dismissed !== snapshot.dismissed
  ) {
    snapshot = next;
  }
  return snapshot;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    computeSnapshot,
    () => snapshot,
  );
}
