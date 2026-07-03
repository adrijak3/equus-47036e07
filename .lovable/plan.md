
## 1. Atostogos (vacations) — new feature

**New table `vacations`**
- Fields: `user_id`, `starts_on`, `ends_on`, `note` (optional)
- RLS: user manages their own; admin sees all
- Users add/edit/delete their vacation ranges in Paskyra (near their existing subscription section) — small form + list
- **User reminder**: on Paskyra + Grafikas, if the acting profile has an upcoming/active vacation, show a soft banner: *"Atostogos: 2026-07-10 → 2026-07-20"*
- **Admin view**: in the users list, show a small badge next to a user's name when they're on vacation, with dates in tooltip. In the redesigned admin dashboard, an "On vacation now/soon" card lists everyone with active or upcoming vacations

## 2. Permanent day notes

Currently the Sat/Sun banners are hardcoded. Extend `slot_notes` so day-level notes have a `recurrence` mode:
- `once` — only that specific date (current behavior)
- `weekly` — repeats every week on that weekday until deleted

**Admin flow** (in Grafikas day header):
- Click the day-note icon → dialog now asks: *"Tik šiai dienai" | "Kas savaitę šią dieną"*
- Lists existing weekly notes for that weekday so admin can delete them
- The old hardcoded Saturday/Sunday text stays as a *seed* (migrated to weekly notes) so admin can now edit/delete them

## 3. Admin panel — full redesign

Replace the current top-tabs layout with a proper admin shell:

```text
┌────────────────────────────────────────────────────────┐
│  Sidebar             │  Header (title + alerts)         │
│  • Apžvalga          ├──────────────────────────────────┤
│  • Vartotojai        │                                  │
│  • Tvarkaraštis      │       Section content            │
│  • Nuolatiniai       │                                  │
│  • Atšaukimai  (•)   │                                  │
│  • Žinutės     (•)   │                                  │
│  • Prenumeratos      │                                  │
│  • Atostogos         │                                  │
└──────────────────────┴──────────────────────────────────┘
```

- **Sidebar navigation** using shadcn `Sidebar` (collapsible to icon strip on mobile). Active section highlighted in gold.
- **New "Apžvalga" (Overview) dashboard** with stat cards: pending cancels, unread messages, active subs count, users on vacation, upcoming week's load. Quick-jump buttons.
- **Vartotojai section**: sortable/searchable list with vacation badges, quick actions (reset password, view lessons, view subs).
- **Alert dots** on sidebar items (unread messages, pending sickness, missing docs) instead of the pulsing chips.
- Consistent card styling, better spacing, section headers with icons, no more cramped grids.

## 4. Lessons scope view (Neapmokėtos → renamed *Pamokų istorija*)

In the user's lessons dialog:
- **Top**: collapsible summary cards per status (Įskaičiuota / Neįskaičiuota / Atšaukta / Liga) with counts + total cost estimate
- **Below**: full chronological month view (as today) with color-coded status chips and filter chips (All / Įskaičiuota / Neįsk. / Atšaukta / Liga) to narrow the list
- Improved typography, spacing, and month navigator

## Technical notes

- New migration for `vacations` table + `recurrence` column on `slot_notes` (enum: `once` | `weekly`).
- Seed existing Sat/Sun banners as weekly notes so the hardcoded text can be removed from `Grafikas.tsx` and become editable.
- Admin shell uses `SidebarProvider` + custom `AdminSidebar` component in `src/components/admin/AdminSidebar.tsx`. Each existing tab becomes a routed sub-view (URL hash or internal state) inside `Admin.tsx`.
- Vacation reminder banner: shared `<VacationBanner />` component used in Paskyra + Grafikas.

## Out of scope (ask if you want these too)

- Automatic "skip lesson booking during vacation" logic
- Notifying trainer/admin by email when a vacation is added
- Charts/analytics beyond simple stat cards
