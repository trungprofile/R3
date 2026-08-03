# R3 QA round 3 — browser pass 1 of 2

**Tester:** Claude (browser automation via Claude-in-Chrome)
**Date:** 2026-08-02
**Account:** `luispark`, PIN `4321` — Volunteer, `DRIVE` + `RECEIVE` duties
**Target:** D22 nav rebuild (`ui-ux-spec.md` §4, as amended), verifying the fix for the historical `navItemsFor` blocker (empty nav at 768–1023px, no `Receive` entry at any width)

## Method note (read before the findings)

Two environment problems shaped how this pass was run. Both are recorded here rather than silently worked around, per instructions.

1. **`resize_window` does not work in this environment.** Every call reported success, but `window.innerWidth` never changed — it stayed at whatever the tab's actual (and inconsistent — 1920 in one tab, 768 by default in another freshly-created tab) width already was, regardless of the width requested. This is worse than the documented macOS 614px clamp: the tool did not resize at all. **All eight required widths (375, 390, 414, 768, 834, 1024, 1280, 1440) were therefore tested using the same-origin-iframe technique** described in the task, for every width, not just the sub-614 phone ones. Each measurement below states `iframe.contentDocument`/`contentWindow` as its source; nothing in this report relies on `resize_window` having worked.

2. **Session interference from what is almost certainly the concurrent "pass 2" run.** Repeatedly, and with no click or navigation issued from this session, the active tab's login silently became a different account ("Ada Grace") and the URL jumped to `/report`; at one point a tab I was using was closed without any close action from me. Since this task explicitly says "browser pass 1 of 2" and instructs both passes to use the same device ID, the most likely explanation is a second automated session sharing this Chrome profile's cookie jar (cookies are shared across tabs in one profile) and, at least once, apparently the tab pool itself. This made sustained multi-step flows fragile: several times a script had to be re-run after silently landing on someone else's session. Where this affected a specific finding, it's noted inline. It did **not** affect the width/overflow/nav-presence findings, which were captured early, before the interference began, and were independently re-confirmed later in a fresh tab.

I did not click Print anywhere.

---

## 1. The blocker: navigation at all eight widths

All eight tested via same-origin iframe (`<iframe style="width:{W}px;height:844-1024px" src="/">`) with Luis's session cookie already active, confirmed by reading `iframe.contentDocument`. `Receive` reachable at every width in **one tap** (bottom-nav icon on ≤1023px, sidenav entry on ≥1024px) — better than the "at most two taps" bar.

| Width | `r3-app` variant | Nav present | Nav shows Receive | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 375 | `phone` | bottom nav, 4 items (Home/Pick up/Receive/Inbox) | yes | **yes — see §3** |
| 390 | `phone` | same | yes | **yes — see §3** |
| 414 | `phone` | same | yes | no scrollbar, but see §3's related finding |
| 768 | `tablet` | bottom nav, 4 items | yes | no |
| 834 | `tablet` | bottom nav, 4 items | yes | no |
| 1024 | `desktop` | left sidenav, grouped (PICKING UP / RECEIVING, no OFFICE — correctly omitted for Luis, §4) | yes | no |
| 1280 | `desktop` | left sidenav, grouped | yes | no |
| 1440 | `desktop` | left sidenav, grouped | yes | no |

1024px correctly renders as `desktop` (sidenav), matching the spec's explicit call-out that current iPad landscape (≥1024) is "desktop" by the build's own pixel bands (`ui-ux-spec.md` Responsive matrix note). No nav was ever empty at any width — **the headline D22 blocker is fixed.**

At every width tested, the sidenav (1024px+) correctly omits the `OFFICE` group entirely for Luis (he holds neither `report` duty nor Staff/Admin tier), matching "Empty groups are omitted entirely, so a driver never sees an OFFICE heading with nothing under it" (`ui-ux-spec.md` §4).

**Tap targets / gaps, measured:**
- Bottom nav (768px): 4 items, each 192×61px. Comfortably over the 44×44 floor. Items are flush against each other (0px gap) — this is the standard full-bleed tab-bar pattern (each item's own hit area is unambiguous and 192px wide), not a case of small adjacent controls at mis-tap risk, so I'm not flagging it against the "8px min gap" principle (`ui-ux-spec.md` §1.2), but note it as a judgment call.
- Sidenav (1280px): 6 items, each exactly 44×223px. Vertical gaps between adjacent items: 8px (meets the floor exactly), 16px, or a full group-header gap. Compliant.
- S2.2 numeric keypad: digit/decimal/backspace keys measured 64px tall (meets "≥64px keys", `ui-ux-spec.md` §3 Numeric keypad exactly at the floor). `Add weight` / `Mark stop weighed` / `Skip stop` buttons: 44px tall (meets the 44×44 floor exactly).
- Home hub cards (390px): 342×135px each, 16px vertical gap. Well clear of both floors.

**Minor, polish-level:** bottom nav is spec'd as "56px tall" (`ui-ux-spec.md` §3, stated as a value, not "≥56"); measured 61px at 768px width. Not a defect (still meets every stated minimum and the extra 5px doesn't harm anything), but flagging the literal mismatch since the spec states a specific number.

---

## 2. Home hub (S1.0) — does it read as two capabilities?

Yes, clearly, for this account. Screenshot captured at true 390px (via iframe, see below) and at 768px (native tab):

- **"Pick up food"** — list-lines icon, "Claim a run, or open the one you already have."
- **"My shifts"** — calendar icon, "The runs you hold, and the days you cannot drive."
- **"Receive a load"** — bar-chart icon, "Weigh what a driver brought in."
- **"Inbox"** — bell icon, "Everything that has happened, newest first."

Each card has a distinct icon, a distinct verb-first title, and a one-line subtitle that names the action in plain language ("Claim", "Weigh") rather than a generic noun. A first-time, non-technical reader has no ambiguity about which card starts driving versus which starts weighing — the two duties read as two different things to do, not one undifferentiated list. This is the intended outcome of D22 and it lands.

One soft observation, not a defect: on Home itself the cards are **not** grouped under "PICKING UP" / "RECEIVING" headers the way the desktop sidenav groups its entries (`ui-ux-spec.md` §4's table). The spec doesn't ask for headers on S1.0 (S1.0's own section only specifies "duties-then-tier" ordering), so this isn't a citable defect — just noting the hub relies on per-card wording to do the grouping work that the sidenav does with an explicit label, and it works, but a coordinator with many more duties (Staff+Admin+report+drive+receive, as seen briefly on a different account mid-session) gets a longer undifferentiated stack of cards with no headers at all.

---

## 3. The known-defect canary — A160 — CONFIRMED STILL PRESENT, exactly as described, plus a related finding

Reproduced at both 390 and 375 via the mandated iframe technique (`iframe.contentDocument`, not a resized real window).

**At 390px:**
```
r3-topbar__user  (the "Luis Park" text span):  left=347  right=347  width=0px   ← collapsed to nothing
r3-topbar__action ("Log out" button):          left=359  right=403  width=44px  ← 13px past the 390px edge
topbar.scrollWidth = 403px vs container clientWidth = 390px  →  13px horizontal overflow
document.documentElement.scrollWidth = 403 vs clientWidth = 390 → page-level horizontal scroll exists
```
The only element with `getBoundingClientRect().right` exceeding the viewport at 390px is `button.r3-topbar__action` ("Log out"), overflowing by **13px**.

**At 375px:** same elements, larger overflow — `Log out` still renders at `left=359, right=403` (the row does not reflow with the narrower viewport at all), so the overflow is **28px** (403 − 375).

**At 414px:** no scroll-overflow (`topbar.scrollWidth === clientWidth === 414`), and `Log out` is visible (`left=359, right=403`). But `r3-topbar__user` ("Luis Park") is **still 0px wide** even here — confirmed via computed style: `width: 0px`, `max-width: 192px`, `overflow: hidden`, `flex-shrink: 1`, `min-width: auto`, `white-space: nowrap`. This is the same root cause one step short of visible overflow: the topbar is a flex row where the Alerts chip (fixed 180px, doesn't shrink), bell (44px), and Log out (44px) all hold their width, and the username is the only item with `flex-shrink: 1` and no `min-width`, so it's squeezed to literal zero rather than truncating gracefully (e.g., to "Luis…" with an ellipsis) once the row is tight. At 414px there's technically no scrollbar, but the "current user" identity the top bar promises (`ui-ux-spec.md` §3 Top bar: "current user + logout right") is invisible.

This reproduces on **every screen** that mounts the shared topbar, including the S1.5 completed-run summary (checked explicitly, same 13px overflow at 390px) — it's not screen-specific, it's the shared `r3-topbar` component, so it affects the whole app at this width band, not one route.

**Per the task's own instruction:** this confirms the canary reproduced correctly, so the phone-width methodology (iframe, not `resize_window`) is validated — the earlier width/nav findings in §1 can be trusted as genuinely phone-width, not desktop-in-disguise.

---

## 4. Navigation dead ends

Checked every screen reachable from Luis's four Home cards, plus the two receive screens named as the historical zero-nav case, plus S1.5's fullscreen takeover and its completed-run summary.

| Screen | Nav / door present | Notes |
| --- | --- | --- |
| S1.0 Home | bottom nav / sidenav | baseline |
| S1.2 Board | bottom nav / sidenav | — |
| S1.3 Shift detail (in-progress, owned) | bottom nav / sidenav | Cancel button correctly hidden with reason shown: *"This run has started, so you cannot cancel it here. Ask a coordinator if you need it covered by someone…"* — matches `ui-ux-spec.md` S1.3: "When it is hidden, the owner is told why and given the way out." |
| S1.4 My shifts, both tabs | bottom nav / sidenav | "When I'm away" copy matches spec verbatim: *"Telling us you're away helps the coordinator fill runs. It won't cancel runs you already own. You'll need to cancel those yourself first."* Tabs switch panel in place without a URL change — correct tab semantics, not filter semantics. |
| S1.9 Inbox | bottom nav / sidenav | Empty state: *"Nothing here yet. You'll see the runs you're on, a reminder an hour before each one, and runs that still need a driver."* — instructive, matches the empty-state contract (§3, §6). |
| **S2.1b Run picker** (`/receive`) | bottom nav present, "Unscheduled donation" button present | **This is the screen the task calls out as having had no nav at all until today. Confirmed fixed** — bottom nav (Home/Pick up/Receive/Inbox) renders at the bottom of the run list at every width tested. |
| **S2.2 Weight entry** (`/receive/:shiftId/stops/:stopId`) | bottom nav present below the keypad | Also confirmed fixed. `Trash` category correctly absent from the 11-category tile set (archived per `D27`) — 10 tiles rendered (Bakery, Dairy, Deli, Dry, Frozen Meat, Frz Non Meat, Health & Beauty, Non Food, Pet, Produce). |
| A denied route (`/report` for a no-`report`-duty volunteer) | bottom nav present **and** an explicit dead-end door | Body reads *"You don't have access to this page. Ask a coordinator if you need it."* with a "Go home" link. Satisfies `ui-ux-spec.md` §3: "A dead-end state … must also carry the way out as a control, not only as advice." |
| **S1.5 Pickup execution, active** | topbar only, confirmed **no** bottom/side nav (`r3-app__fullscreen` with no nav sibling in the DOM) | By design — matches spec. |
| **S1.5 completed-run summary** | topbar only; exactly **one** control in the main content area: **"Go home"** | Confirmed via `document.querySelectorAll('button,a')` → `["Alerts OFF, tap to fix", "" (bell), "Log out", "Go home"]`. Everything else is read-only text: route name, truck, "You completed this run · 5:46 PM", each stop's disposition, the run note, and the copy *"You can no longer add an extra pickup here. Phone the pantry if you picked up somewhere that is not on this list."* — matches `D23`/`ui-ux-spec.md` S1.5 exactly, including the removal of "Flag a stop not on my route" from this screen and the explicit phone-the-pantry remediation. |

**Chain-of-custody caveat on the S1.5 completed-run finding:** because of the session interference described above, I did not personally click through "start truck → mark 3 stops picked up → tap Complete this run → confirm" in one deliberate, uninterrupted sequence — that shift was already in the completed state (with a run note already attached) when I revisited it by direct URL, most likely as a side effect of an earlier confused click sequence in this same session rather than pass 2's account. I'm reporting the **end state** (one control, correct copy, correct read-only rendering) as genuine and independently re-verified (including the width-390 overflow check), but flagging that I did not author the completion flow myself end-to-end in this pass.

**Not exercised in this pass, for the same reason (running low on stable, uninterrupted session time):** live weight entry submission (`Add weight` → category subtotal update), `Skip stop`, and the `S2.2 → S2.2b Receive done → COMPLETED` transition. The screen's static contract (tap targets, keypad size, category set, nav presence) was verified; the write path was not exercised.

---

## 5. Console

Checked after every navigation across: Home, Board, Shift detail, My Shifts (both tabs), Inbox, the denied-route dead end, S2.1b run picker, S2.2 weight entry, S1.5 active and S1.5 completed-run summary.

**No errors or exceptions on any of the above.** Console only ever showed benign Vite HMR connect/reconnect messages and the standard React DevTools info line.

---

## Untestable from here

- **True `resize_window` behavior.** The tool did not resize the real window at all in this environment (see Method note). All width-specific findings above come from the iframe technique, which is faithful to CSS media-query layout but does not exercise real touch, the visual viewport, or browser chrome (per the task's own caveat).
- **Concurrent multi-user race conditions** (e.g., two receivers resolving different stops on the same run simultaneously, or a claim race on the board) — one browser tab, no parallel authenticated session under my control.
- **The "Still here?" ~30s timeout prompt** — inactivity-driven logouts were observed during this pass, consistent with a short timeout firing, but I never caught the prompt itself mid-transition, and given the session interference described above I can't be certain a given logout was the timeout rather than another session overwriting the shared cookie. Not confirmed either way.
- **S2.2's live write path** (Add weight, Skip stop, Mark stop weighed, Receive done) and **S1.5's live completion click-through** — see caveats in §4.
- **window.print()** — explicitly not triggered, per instructions.
- **Real touch/native input** — all interaction was synthetic click events or the computer tool's simulated click, never real touch, per the standing tool limitations.

## Summary

The D22 nav rebuild does what it set out to do: navigation is present and Receive is one tap away at every one of the eight required widths, including the historically-broken 768–1023px band, and the Home hub reads as two clearly distinct capabilities for a driver+receiver account. The A160 canary is confirmed **not** fixed — the shared topbar overflows by 13px at 390px and 28px at 375px, clipping "Log out" off-screen, and even at 414px (no scroll-overflow) the username collapses to 0-width — this is a single shared-component defect (the topbar's flex layout gives the username `flex-shrink` with no `min-width` while its siblings don't shrink at all) and it affects every screen in the app at this width band, not just one screen. Dead-end handling is solid everywhere checked, including the two screens (S2.1b, S2.2) that used to have no nav at all.
