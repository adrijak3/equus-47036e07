import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  X,
  LogOut,
  User as UserIcon,
  Calendar,
  Tag,
  ShieldCheck,
  Phone,
  MapPin,
  Sparkles,
  Users as UsersIcon,
  Check,
  Info,
  Home,
  Palette,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { cn } from "@/lib/utils";

const NAV_GUEST = [
  { to: "/", label: "Grafikas", icon: Calendar },
  { to: "/kainos", label: "Kainos", icon: Tag },
  { to: "/informacija", label: "Informacija", icon: Info },
  { to: "/paskyra", label: "Paskyra", icon: UserIcon },
];

const NAV_USER = [
  { to: "/", label: "Pradžia", icon: Home },
  { to: "/grafikas", label: "Grafikas", icon: Calendar },
  { to: "/kainos", label: "Kainos", icon: Tag },
  { to: "/informacija", label: "Informacija", icon: Info },
  { to: "/paskyra", label: "Paskyra", icon: UserIcon },
];

/*
  Trenerio sritis sąmoningai nėra šiame sąraše.
  Ji rodoma kaip atskiras blizgantis mygtukas žemiau.
*/
const NAV_ADMIN = [
  { to: "/", label: "Pradžia", icon: Home },
  { to: "/grafikas", label: "Grafikas", icon: Calendar },
  { to: "/kainos", label: "Kainos", icon: Tag },
  { to: "/informacija", label: "Informacija", icon: Info },
];

const NAV_TRAINER = [
  { to: "/", label: "Pradžia", icon: Home },
  { to: "/grafikas", label: "Grafikas", icon: Calendar },
  { to: "/kainos", label: "Kainos", icon: Tag },
  { to: "/informacija", label: "Informacija", icon: Info },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);

  const {
    user,
    isAdmin,
    isTrainer,
    profile,
    signOut,
    linkedProfiles,
    activeProfileId,
    setActiveProfileId,
  } = useAuth();

  const location = useLocation();
  const navigate = useNavigate();

  const close = () => {
    setOpen(false);
    setThemesOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    close();
    navigate("/");
  };

  const navigationItems = isAdmin
    ? NAV_ADMIN
    : isTrainer
      ? NAV_TRAINER
      : user
        ? NAV_USER
        : NAV_GUEST;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Viršutinė juosta */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-gold/10">
        <div className="container flex items-center justify-between h-16">
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            onClick={close}
          >
            <span className="text-2xl font-display tracking-wide text-gradient-gold">
              Equus
            </span>

            <span className="hidden sm:inline text-xs uppercase tracking-[0.25em] text-muted-foreground/70 font-body">
              jojimo mokykla
            </span>
          </Link>

          <button
            type="button"
            aria-label={open ? "Uždaryti meniu" : "Atidaryti meniu"}
            onClick={() => setOpen((current) => !current)}
            className="relative w-10 h-10 flex items-center justify-center rounded-md border border-gold/20 hover:border-gold/50 transition-colors"
          >
            {open ? (
              <X className="w-5 h-5 text-gold" />
            ) : (
              <Menu className="w-5 h-5 text-gold" />
            )}
          </button>
        </div>
      </header>

      {/* Išvažiuojantis meniu */}
      <div
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300",
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
      >
        <div
          className="absolute inset-0 bg-background/85 backdrop-blur-md"
          onClick={close}
        />

        <aside
          className={cn(
            "absolute right-0 top-0 h-full w-full sm:w-96",
            "bg-gradient-card border-l border-gold/20 shadow-elegant",
            "transition-transform duration-500 ease-out flex flex-col",
            open ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-6 h-16 border-b border-gold/10">
            <span className="text-xl font-display text-gradient-gold">
              Meniu
            </span>

            <button
              type="button"
              onClick={close}
              className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-gold/10 transition-colors"
              aria-label="Uždaryti"
            >
              <X className="w-5 h-5 text-gold" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <nav className="px-4 py-6 space-y-1">
              {navigationItems.map(({ to, label, icon: Icon }) => {
                const active =
                  to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(to);

                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={close}
                    className={cn(
                      "flex items-center gap-4 px-4 py-3.5 rounded-md",
                      "transition-all group border-l-2",
                      active
                        ? "bg-gold/10 text-gold border-gold"
                        : "text-foreground/80 hover:text-gold hover:bg-gold/5 border-transparent",
                    )}
                  >
                    <Icon className="w-4 h-4" />

                    <span className="text-base font-display tracking-wide">
                      {label}
                    </span>
                  </Link>
                );
              })}

              {/* Administratoriaus skiltis */}
              {isAdmin && (
                <Link
                  to="/admin"
                  onClick={close}
                  className={cn(
                    "flex items-center gap-4 px-4 py-3.5 rounded-md",
                    "transition-all border-l-2",
                    location.pathname.startsWith("/admin")
                      ? "bg-gold/10 text-gold border-gold"
                      : "text-blush hover:bg-gold/5 border-transparent",
                  )}
                >
                  <ShieldCheck className="w-4 h-4" />

                  <span className="text-base font-display tracking-wide">
                    Admin
                  </span>
                </Link>
              )}

              {/* Vienintelė blizganti trenerio skiltis */}
              {isTrainer && (
                <Link
                  to="/trener"
                  onClick={close}
                  className={cn(
                    "relative overflow-hidden",
                    "flex items-center gap-4 px-4 py-3.5 rounded-md",
                    "transition-all border border-gold/30",
                    "bg-gradient-to-r from-gold/5 via-gold/15 to-gold/5",
                    "hover:border-gold/60 hover:shadow-gold",
                    location.pathname.startsWith("/trener")
                      ? "text-gold border-gold/70 shadow-gold"
                      : "text-gold/90",
                  )}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-1000" />

                  <Sparkles className="relative z-10 w-4 h-4" />

                  <span className="relative z-10 text-base font-display tracking-wide">
                    Trenerio sritis
                  </span>
                </Link>
              )}
            </nav>

        {/* Temų pasirinkimas */}
{user && (
  <div className="mx-4 mb-5 rounded-2xl border border-gold/20 bg-card/70 overflow-hidden">
    <button
      type="button"
      onClick={() => setThemesOpen((current) => !current)}
      className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left hover:bg-gold/5 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gold/10 flex items-center justify-center">
          <Palette className="w-4 h-4 text-gold" />
        </div>

        <div>
          <div className="font-display text-sm tracking-wide text-foreground">
            Keisti svetainės temą
          </div>

          <div className="text-xs text-muted-foreground">
            Pasirinkite mėgstamiausią sezoną
          </div>
        </div>
      </div>

      <span
        className={cn(
          "text-gold text-lg transition-transform duration-300",
          themesOpen && "rotate-180",
        )}
      >
        ⌄
      </span>
    </button>

    {themesOpen && (
      <div className="border-t border-gold/10 p-4 bg-background/30">
        <ThemeSwitcher compact />
      </div>
    )}
  </div>
)}

          {/* Apatinė paskyros dalis */}
          <div className="p-6 border-t border-gold/10 space-y-3">
            {user ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Prisijungta kaip

                  <div className="text-foreground font-medium mt-0.5">
                    {profile?.full_name ?? user.email}
                  </div>
                </div>

                {linkedProfiles.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] uppercase tracking-wider text-gold/70 flex items-center gap-1.5">
                      <UsersIcon className="w-3 h-3" />
                      Aktyvus profilis
                    </div>

                    <div className="grid gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveProfileId(user.id);
                          close();
                        }}
                        className={cn(
                          "flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                          activeProfileId === user.id
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-gold/15 text-foreground/80 hover:bg-gold/5",
                        )}
                      >
                        <span>{profile?.full_name ?? "Aš"}</span>

                        {activeProfileId === user.id && (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {linkedProfiles.map((linkedProfile) => (
                        <button
                          type="button"
                          key={linkedProfile.id}
                          onClick={() => {
                            setActiveProfileId(linkedProfile.profile_id);
                            close();
                          }}
                          className={cn(
                            "flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                            activeProfileId === linkedProfile.profile_id
                              ? "border-gold/50 bg-gold/10 text-gold"
                              : "border-gold/15 text-foreground/80 hover:bg-gold/5",
                          )}
                        >
                          <span>{linkedProfile.display_name}</span>

                          {activeProfileId === linkedProfile.profile_id && (
                            <Check className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  variant="outlineGold"
                  className="w-full"
                  onClick={handleSignOut}
                >
                  <LogOut className="w-4 h-4" />
                  Atsijungti
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="gold"
                  className="w-full"
                  onClick={() => {
                    close();
                    navigate("/auth");
                  }}
                >
                  Prisijungti
                </Button>

                <Button
                  variant="outlineGold"
                  className="w-full"
                  onClick={() => {
                    close();
                    navigate("/auth?tab=signup");
                  }}
                >
                  Registruotis
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-gold/10 mt-16">
        <div className="container py-10 text-center space-y-4">
          <div className="font-display text-lg text-gradient-gold">
            Equus jojimo mokykla
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2 sm:gap-6 text-sm">
            <a
              href="tel:+37065822872"
              className="inline-flex items-center justify-center gap-1.5 text-foreground/85 hover:text-gold transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-gold" />
              Laura · +370 658 22872
            </a>

            <a
              href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-foreground/85 hover:text-gold transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-gold" />
              Pakamšės g. 7, Daučionys, 14245 Vilniaus r. sav.
            </a>
          </div>

          <p className="text-xs text-muted-foreground tracking-wide">
            © 2026 Equus Jojimo Mokykla. Visos teisės saugomos.
            Svetainės visos autoriaus teisės priklauso Adrijai Kalikaitei.
          </p>
        </div>
      </footer>
    </div>
  );
}
