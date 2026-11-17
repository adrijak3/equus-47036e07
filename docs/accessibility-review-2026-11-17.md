# Equus accessibility review — 2026-11-17

Scope: source-code review of the public-facing schedule, login, registration, global navigation, and seasonal CSS themes. WCAG 2.2 AA is the target, **not a claim of conformance**. The live site was inaccessible to automated browser retrieval during this review. No assistive-technology or physical-device audit has yet been completed.

## Confirmed source-level issues and changes
- Keyboard skip navigation missing: a visible-on-focus "Pereiti prie pagrindinio turinio" link and focusable main landmark added.
- Global focus visibility only covered a limited set: expanded focus-visible coverage to summaries, tabs, and role buttons.
- Small schedule labels: elevated several 9–10 px schedule statuses to a 12 px minimum (follow-up: 14 px for key information, subject to responsive visual testing).
- Some controls too small: expanded top menu and menu-close buttons to 44 px. Several admin-specific schedule controls still use 20 px and need layout-aware remediation.
- Reduced motion: expanded existing preference handling to all animation/transition effects.
- Theme contrast: adjusted Spring accent, Summer muted copy and primary-button foreground, Ocean accent/primary tokens. Contrast calculations must be rechecked against actual rendered layers and interactive states; background gradients and transparency may produce different effective results.

## Follow-up checks required before WCAG 2.2 AA sign-off
1. Evaluate each theme + light/dark variation at 320 px, 200% and 400% zoom; check reflow/overflow and foreground/background contrast in all states.
2. Keyboard-only test: login, registration, schedule day/week tabs, booking, waitlist, horse selection, dialog open/close and focus restoration.
3. VoiceOver (iOS) and TalkBack (Android): verify interactive names, descriptions, field errors, status announcements, dynamic schedule updates.
4. Ensure availability, selected state, disabled state and error feedback have readable non-color indicators.
5. Check target sizing and spacing of schedule controls and bottom-navigation labels.
6. Test authentication CAPTCHA accessibility and alternative methods where applicable.
7. Validate page titles and heading hierarchy across route transitions.
8. Run axe-core plus manual WCAG 2.2 AA review; do not substitute an automated pass for a full audit.

## Safeguards
This work changes only CSS, React navigation markup, and schedule typography. It does not modify booking logic, user roles, payment logic, subscriptions, or Supabase data.
