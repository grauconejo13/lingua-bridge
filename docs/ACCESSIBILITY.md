# Accessibility

Lingua Bridge is meant for people who may be reading in a second language, using a phone in a noisy room, or relying on a screen reader. This page records what is checked and how.

## Automated checks

**In CI** (`apps/web/src/a11y.test.tsx`): axe-core runs WCAG 2.1 A/AA and best-practice rules against every screen (translator, conversation start and invite, presentation start, presenter, audience, admin sign-in). jsdom has no layout, so colour contrast is excluded there.

**In a real browser** (headless Chrome, 390 × 844, light and dark): axe-core with WCAG 2.2 AA and best-practice rules on 16 screen states, including contrast. That covers all of the screens above, the presenter with a live talk, the audience with captions, the settings menu open, and the signed-in admin dashboard.

| Date       | Screens × themes | Violations before | After |
| ---------- | ---------------- | ----------------- | ----- |
| 2026-11-07 | 8 × 2            | 3 kinds           | 0     |

Found and fixed:

- **Banners outside landmarks** (moderate, every screen): status banners such as demo mode, reconnecting and the language limit sat outside any page region, so people navigating by region skipped them. They are now grouped in named regions ("Server status", "Presentation status", "Conversation status").
- **Scrollable table not keyboard reachable** (serious, admin): the provider table scrolls sideways on phones but couldn't be focused. Its scroll area is now a focusable, named region.
- **Duplicate landmark name** (moderate, admin): fixed while fixing the item above.

## Manual checks

- **Keyboard:** tab order follows the visual order on the presenter screen, and every control shows a focus ring.
- **Full-screen QR dialog:** focus now moves into it, stays there, and returns to the button that opened it on close. Escape closes it. Before this fix, focus could escape behind the dialog.
- **Live regions:** new captions and messages are announced politely, one at a time; status changes use `role="status"`; errors use `role="alert"`.
- **Language and direction:** every caption carries `lang` and `dir`, so screen readers switch voices and right-to-left scripts display correctly. Verified with Arabic in a browser run.
- **Motion:** meter animations respect `prefers-reduced-motion`.

## Not yet done

- Testing with real screen readers (VoiceOver on iOS, TalkBack on Android) and with people who use them.
- Captions at the largest text size on small phones, with real long sentences.
- Reviewing the presenter flow with switch access.
