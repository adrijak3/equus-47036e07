import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Calendar,
  Check,
  ChevronDown,
  Home,
  Info,
  LogOut,
  MapPin,
  Menu,
  Palette,
  Phone,
  ShieldCheck,
  Sparkles,
  Tag,
  User as UserIcon,
  Users as UsersIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const NAV_GUEST = [
  {
    to: "/",
    label: "Grafikas",
    icon: Calendar,
  },
  {
    to: "/kainos",
    label: "Kainos",
    icon: Tag,
  },
  {
    to: "/informacija",
    label: "Informacija",
    icon: Info,
  },
  {
    to: "/paskyra",
    label: "Paskyra",
    icon: UserIcon,
  },
];

const NAV_USER = [
  {
    to: "/",
    label: "Pradžia",
    icon: Home,
  },
  {
    to: "/grafikas",
    label: "Grafikas",
    icon: Calendar,
  },
  {
    to: "/kainos",
    label: "Kainos",
    icon: Tag,
  },
  {
    to: "/informacija",
    label: "Informacija",
    icon: Info,
  },
  {
    to: "/paskyra",
    label: "Paskyra",
    icon: UserIcon,
  },
];

const NAV_ADMIN = [
  {
    to: "/",
    label: "Pradžia",
    icon: Home,
  },
  {
    to: "/grafikas",
    label: "Grafikas",
    icon: Calendar,
  },
  {
    to: "/kainos",
    label: "Kainos",
    icon: Tag,
  },
  {
    to: "/informacija",
    label: "Informacija",
    icon: Info,
  },
];

const NAV_TRAINER = [
  {
    to: "/",
    label: "Pradžia",
    icon: Home,
  },
  {
    to: "/grafikas",
    label: "Grafikas",
    icon: Calendar,
  },
  {
    to: "/kainos",
    label: "Kainos",
    icon: Tag,
  },
  {
    to: "/informacija",
    label: "Informacija",
    icon: Info,
  },
];

export default function Layout({
  children,
}: {
  children: ReactNode;
}) {
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

  const isLinkActive = (to: string) => {
    if (to === "/") {
      return location.pathname === "/";
    }

    return location.pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Viršutinė juosta */}
      <header className="sticky top-0 z-40 border-b border-gold/10 bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <Link
            to="/"
            onClick={close}
            className="group flex items-center gap-2.5"
          >
            <span className="text-gradient-gold font-display text-2xl tracking-wide">
              Equus
            </span>

            <span className="font-body hidden text-xs uppercase tracking-[0.25em] text-muted-foreground/70 sm:inline">
              jojimo mokykla
            </span>
          </Link>

          <button
            type="button"
            aria-label={open ? "Uždaryti meniu" : "Atidaryti meniu"}
            onClick={() => setOpen((current) => !current)}
            className="relative flex h-10 w-10 items-center justify-center rounded-md border border-gold/20 transition-colors hover:border-gold/50"
          >
            {open ? (
              <X className="h-5 w-5 text-gold" />
            ) : (
              <Menu className="h-5 w-5 text-gold" />
            )}
          </button>
        </div>
      </header>

      {/* Meniu fonas ir šoninė juosta */}
      <div
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          aria-label="Uždaryti meniu"
          onClick={close}
          className="absolute inset-0 bg-background/85 backdrop-blur-md"
        />

        <aside
          className={cn(
            "bg-gradient-card absolute right-0 top-0 flex h-full w-full flex-col border-l border-gold/20 shadow-elegant sm:w-96",
            "transition-transform duration-500 ease-out",
            open ? "translate-x-0" : "translate-x-full",
          )}
        >
          {/* Meniu antraštė */}
          <div className="flex h-16 items-center justify-between border-b border-gold/10 px-6">
            <span className="text-gradient-gold font-display text-xl">
              Meniu
            </span>

            <button
              type="button"
              onClick={close}
              aria-label="Uždaryti"
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-gold/10"
            >
              <X className="h-5 w-5 text-gold" />
            </button>
          </div>

          {/* Slenkama meniu dalis */}
          <div className="flex-1 overflow-y-auto">
            <nav className="space-y-1 px-4 py-6">
              {navigationItems.map(({ to, label, icon: Icon }) => {
                const active = isLinkActive(to);

                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={close}
                    className={cn(
                      "group flex items-center gap-4 rounded-md border-l-2 px-4 py-3.5 transition-all",
                      active
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-transparent text-foreground/80 hover:border-gold/30 hover:bg-gold/5 hover:text-gold",
                    )}
                  >
                    <Icon className="h-4 w-4" />

                    <span className="font-display text-base tracking-wide">
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
                    "flex items-center gap-4 rounded-md border-l-2 px-4 py-3.5 transition-all",
                    location.pathname.startsWith("/admin")
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-transparent text-blush hover:bg-gold/5",
                  )}
                >
                  <ShieldCheck className="h-4 w-4" />

                  <span className="font-display text-base tracking-wide">
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
                    "relative flex items-center gap-4 overflow-hidden rounded-md border px-4 py-3.5 transition-all",
                    "border-gold/30 bg-gradient-to-r from-gold/5 via-gold/15 to-gold/5",
                    "hover:border-gold/60 hover:shadow-gold",
                    location.pathname.startsWith("/trener")
                      ? "border-gold/70 text-gold shadow-gold"
                      : "text-gold/90",
                  )}
                >
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

                  <Sparkles className="relative z-10 h-4 w-4" />

                  <span className="relative z-10 font-display text-base tracking-wide">
                    Trenerio sritis
                  </span>
                </Link>
              )}
            </nav>
{/* Kalbos pasirinkimas */}
<div className="mx-4 mb-5">
  <LanguageSwitcher />
</div>
            {/* Temų pasirinkimas – matomas visiems prisijungusiems */}
            {user && (
              <div className="mx-4 mb-5 overflow-hidden rounded-2xl border border-gold/20 bg-card/70">
                <button
                  type="button"
                  onClick={() =>
                    setThemesOpen((current) => !current)
                  }
                  className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-gold/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/10">
                      <Palette className="h-4 w-4 text-gold" />
                    </div>

                    <div>
                      <div className="font-display text-sm tracking-wide text-foreground">
                        Keisti svetainės temą
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Automatinė arba pasirinktas sezonas
                      </div>
                    </div>
                  </div>

                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-gold transition-transform duration-300",
                      themesOpen && "rotate-180",
                    )}
                  />
                </button>

                {themesOpen && (
                  <div className="border-t border-gold/10 bg-background/30 p-4">
                    <ThemeSwitcher compact />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Paskyros dalis apačioje */}
          <div className="space-y-3 border-t border-gold/10 p-6">
            {user ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Prisijungta kaip

                  <div className="mt-0.5 font-medium text-foreground">
                    {profile?.full_name ?? user.email}
                  </div>
                </div>

                {linkedProfiles.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gold/70">
                      <UsersIcon className="h-3 w-3" />
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
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {linkedProfiles.map((linkedProfile) => (
                        <button
                          type="button"
                          key={linkedProfile.id}
                          onClick={() => {
                            setActiveProfileId(
                              linkedProfile.profile_id,
                            );
                            close();
                          }}
                          className={cn(
                            "flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                            activeProfileId ===
                              linkedProfile.profile_id
                              ? "border-gold/50 bg-gold/10 text-gold"
                              : "border-gold/15 text-foreground/80 hover:bg-gold/5",
                          )}
                        >
                          <span>{linkedProfile.display_name}</span>

                          {activeProfileId ===
                            linkedProfile.profile_id && (
                            <Check className="h-3.5 w-3.5" />
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
                  <LogOut className="h-4 w-4" />
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

      <main className="flex-1">
        {children}
      </main>

      <footer className="mt-16 border-t border-gold/10">
        <div className="container space-y-4 py-10 text-center">
          <div className="text-gradient-gold font-display text-lg">
            Equus jojimo mokykla
          </div>

          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-center sm:gap-6">
            <a
              href="tel:+37065822872"
              className="inline-flex items-center justify-center gap-1.5 text-foreground/85 transition-colors hover:text-gold"
            >
              <Phone className="h-3.5 w-3.5 text-gold" />
              Laura · +370 658 22872
            </a>

            <a
              href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-foreground/85 transition-colors hover:text-gold"
            >
              <MapPin className="h-3.5 w-3.5 text-gold" />
              Pakamšės g. 7, Daučionys, 14245 Vilniaus r. sav.
            </a>
          </div>

          <p className="text-xs tracking-wide text-muted-foreground">
            © 2026 Equus Jojimo Mokykla. Visos teisės saugomos.
            Svetainės visos autoriaus teisės priklauso Adrijai
            Kalikaitei.
          </p>
        </div>
      </footer>
    </div>
  );
}
