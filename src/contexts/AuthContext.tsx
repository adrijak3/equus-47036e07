import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTrainer, setIsTrainer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkedProfiles, setLinkedProfiles] = useState<LinkedProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(null);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: roles }, { data: links }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profile_links" as any).select("id, linked_profile_id, display_name").eq("parent_user_id", uid),
    ]);
    setProfile(prof ?? null);
    setIsAdmin((roles ?? []).some((r) => r.role === "admin"));
    setIsTrainer((roles ?? []).some((r) => r.role === "trainer"));
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
    // Listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // defer to avoid deadlock
        setTimeout(() => loadUserData(newSession.user.id), 0);
      } else {
        setProfile(null);
        setIsAdmin(false);
        setIsTrainer(false);
        setLinkedProfiles([]);
        setActiveProfileIdState(null);
      }
    });

    // Then fetch existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadUserData(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
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
    setLinkedProfiles([]);
    setActiveProfileIdState(null);
    localStorage.removeItem("equus_active_profile");
  };

  return (
    <AuthContext.Provider value={{
      session, user, profile, isAdmin, isTrainer, loading,
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
