import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
}

export interface LinkedProfile {
  id: string;            // profile_links.id
  profile_id: string;    // linked profile user_id
  display_name: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  isTrainer: boolean;
  isHalfAdmin: boolean;
  loading: boolean;
  /** Linked sub-profiles (e.g. Jurgita's daughter Nomina) */
  linkedProfiles: LinkedProfile[];
  /** Currently active profile id — defaults to user.id; changes when switched */
  activeProfileId: string | null;
  activeProfileName: string;
  setActiveProfileId: (id: string) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const lastLoadedUserId = useRef<string | null>(null);
  const lastRoleRefresh = useRef(0);
  const loadingUserId = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTrainer, setIsTrainer] = useState(false);
  const [isHalfAdmin, setIsHalfAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkedProfiles, setLinkedProfiles] = useState<LinkedProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(null);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: roles }, { data: links }, { data: effectiveAdmin }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profile_links" as any).select("id, linked_profile_id, display_name").eq("parent_user_id", uid),
      (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" }),
    ]);
    setProfile(prof ?? null);
    setIsAdmin(effectiveAdmin === true || (roles ?? []).some((r) => r.role === "admin"));
    setIsTrainer((roles ?? []).some((r) => r.role === "trainer"));
    setIsHalfAdmin((roles ?? []).some((r) => (r as any).role === "half_admin"));
    const lps: LinkedProfile[] = ((links as any[]) ?? []).map((l) => ({
      id: l.id, profile_id: l.linked_profile_id, display_name: l.display_name,
    }));
    setLinkedProfiles(lps);
    // Restore active profile from localStorage if still valid
    const stored = localStorage.getItem("equus_active_profile");
    const valid = stored && (stored === uid || lps.some((l) => l.profile_id === stored));
    setActiveProfileIdState(valid ? stored! : uid);
  };

  useEffect(() => {
    // Fetch the profile once per user, not for every token refresh.
    // Supabase broadcasts INITIAL_SESSION/TOKEN_REFRESHED/SIGNED_IN even
    // when the authenticated user has not changed.
    const ensureUserLoaded = (uid: string) => {
      if (lastLoadedUserId.current === uid || loadingUserId.current === uid) return;
      loadingUserId.current = uid;
      setTimeout(() => {
        void loadUserData(uid).then(() => {
          lastLoadedUserId.current = uid;
          lastRoleRefresh.current = Date.now();
        }).finally(() => {
          loadingUserId.current = null;
          setLoading(false);
        });
      }, 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        ensureUserLoaded(newSession.user.id);
      } else {
        lastLoadedUserId.current = null;
        loadingUserId.current = null;
        lastRoleRefresh.current = 0;
        setProfile(null);
        setIsAdmin(false);
        setIsTrainer(false);
        setIsHalfAdmin(false);
        setLinkedProfiles([]);
        setActiveProfileIdState(null);
        setLoading(false);
      }
    });

    void supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) ensureUserLoaded(existing.user.id);
      else setLoading(false);
    });

    // Admin privileges can be time limited, so refresh on focus and in the
    // background, but avoid fetching profile + roles on every minute/tap.
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRoleRefresh.current < 5 * 60_000) return;
      void supabase.auth.getSession().then(({ data: { session: active } }) => {
        if (!active?.user || loadingUserId.current === active.user.id) return;
        lastRoleRefresh.current = Date.now();
        void loadUserData(active.user.id);
      });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const roleRefresh = window.setInterval(onFocus, 60_000);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(roleRefresh);
    };
  }, []);

  const refreshProfile = async () => {
    if (user) await loadUserData(user.id);
  };

  const setActiveProfileId = (id: string) => {
    setActiveProfileIdState(id);
    localStorage.setItem("equus_active_profile", id);
  };

  const activeProfileName =
    activeProfileId && activeProfileId !== user?.id
      ? linkedProfiles.find((l) => l.profile_id === activeProfileId)?.display_name ?? profile?.full_name ?? ""
      : profile?.full_name ?? "";

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdmin(false);
    setIsTrainer(false);
    setIsHalfAdmin(false);
    setLinkedProfiles([]);
    setActiveProfileIdState(null);
    localStorage.removeItem("equus_active_profile");
  };

  return (
    <AuthContext.Provider value={{
      session, user, profile, isAdmin, isTrainer, isHalfAdmin, loading,
      linkedProfiles, activeProfileId, activeProfileName, setActiveProfileId,
      signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
