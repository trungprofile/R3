# QA Round 2 — Pass 4: The admin back office

**Role:** adagrace — ADMIN tier, all duties (Drive, Receive, Report)
**Viewport:** requested 1440×900; `window.innerWidth` reported 1440×813 (browser chrome takes the rest of the height; width is exact, not the phone-clamp failure mode described in the harness notes)
**Screens:** S1.8 Admin, all six tabs (Metrics, Accounts, Donors, Trucks, Categories, Category matching) + `/metrics` redirect

---

## Defects

### 1. "Add someone" (account creation) omits the Admin tier option that "Edit account" offers
**Screen:** S1.8 Admin → Accounts → Add someone
**Severity:** minor
**Device/viewport:** desktop, 1440×813
**Role simulated:** Admin, all duties
**Expected (spec citation):** `ui-ux-spec.md` S1.8: "Accounts: list of users; create (first/last → auto username shown read-only), assign tier (Volunteer/Staff/Admin) and duties..." — tier assignment at creation time is explicitly named as a three-way choice.
**Actual:** The "What they can reach" segmented control on the **create** form (`Add someone`) renders only two buttons, **Volunteer** and **Staff** — confirmed via DOM query (`role="group"` container has exactly two `<button>` children). The **Edit account** screen for an existing user shows all three: Volunteer, Staff, **Admin**. An admin cannot create a new Admin account directly; the workaround is to create as Staff, save, then reopen the new account and promote it to Admin in a second step. Functional (the workaround exists and worked when tested — creating an account then editing its tier to Admin succeeds), so this is not a blocker, but it is a clear, reproducible deviation from the spec's explicit three-way list at the create step, and a paper-first admin has no way to know the extra step is needed.
**Repro steps:**
1. Admin → Accounts → Add someone.
2. Inspect "What they can reach": only Volunteer / Staff shown.
3. Cancel out, open any existing account's Edit screen instead: Volunteer / Staff / Admin all present.
**Screenshot:** not saved; confirmed via `read_page` (interactive-elements) and a direct DOM query on the segmented-control container.

---

## Confirmed correct (explicit checks for this pass)

### R6 — one back office instead of two
- **Metrics is the default tab** and opens first on `/admin`.
- **All six tabs are a real tablist**: `role="tablist"` with `aria-label`, each tab `role="tab"`, roving `tabindex` (selected tab `tabindex="0"`, others `-1"`), correct `aria-selected`/`aria-controls`/`id` wiring, and exactly one `role="tabpanel"` rendered at a time.
- **Keyboard behavior confirmed**: ArrowRight moves selection+focus to the next tab and switches the panel; **End** jumps to the last tab (Category matching); **Home** jumps to the first (Metrics). All confirmed via real DOM focus + `aria-selected` + URL checks, not just visual inspection.
- **`/metrics` still resolves**, redirecting to `/admin?tab=metrics`.
- **The tab lives in the URL**: clicking a tab updates `?tab=`; a full page reload on `/admin?tab=accounts` reopens directly on Accounts, not bounced to Metrics.
- Console stayed clean across every tab load and every action in this pass; no horizontal overflow found on any tab at 1440×813 (`document.body.scrollWidth` never exceeded `window.innerWidth`).
- **Nested tablist consistency:** the Metrics tab's own "Intake / Missed runs" sub-control (S3.2) is built the same way — `role="tablist"`, roving tabindex — and both sub-panels (What came in / Runs that never happened) rendered correctly with their own filters (driver/route for Coverage).
- One tooling note, not a defect: the extension's synthetic mouse click sometimes only *focuses* a tab button without firing its `onClick` (a second click at the same coordinates then registers). This is a CDP/extension quirk, confirmed by dispatching a real `KeyboardEvent` programmatically on a JS-focused element and watching the same handler fire correctly — the app's own click and keyboard handling is not at fault.

### R7 — a store's photo and map link
- **Map link set/clear round-trips correctly.** Cleared Northside Grocery's existing `mapUrl` (confirmed empty on reload); set a new map link on Eastgate Foods (had none), confirmed it read back correctly (`GET /api/donors` showed the persisted `mapUrl`).
- **Large-photo upload worked end to end and is stored resized, not at source size.** Built a 3200×2400 canvas, exported as JPEG at quality 0.92 (**318,082 bytes**, i.e. ~318KB — comfortably inside the fixed 600KB `express.json` cap and well past the old 64KB cap that used to break this exact case), attached it to the hidden `<input type="file">` via `DataTransfer` + a dispatched `change` event (never touched the native picker). No console errors on upload or on Save. The stored/rendered image reports `naturalWidth: 800, naturalHeight: 600` (4:3 preserved) as a `data:image/jpeg;base64,...` string of **35,903 characters (~26KB)** — the resize path (`resizedPhotoDataUrl`) is doing real work, not just relabeling the original file.
- Reloading the donor list from a fresh navigation and reopening the donor confirmed the photo persisted server-side (not just client memory).
- **Clearing a photo works.** "Remove the photo" reverts the card to "No photo yet." / "Choose a photo," and Save persists it — `GET /api/donors` confirms `hasPhoto: false` afterward. It is **visually and structurally identical** to a donor that never had a photo (no history marker either way) — this appears to be intentional per the spec's empty-state rule ("say what to do next," not "show what used to be here"), so recorded as confirmed behavior, not a defect. Flagging as an **open question**: whether the pantry ever wants to know "this store used to have a photo" is undocumented either way.
- **PII (A24):** as Admin, phone and address fields are editable on both Donors and Accounts edit screens (confirmed on Sam Okafor's Staff account: phone `5550002222`, address `2 Pantry Way`, both in plain editable text inputs). Donor `address`/`contact` fields are present and editable, never trimmed, as required.

### I21 — delete branches, one control, server decides
Both branches confirmed, and the UI never asks the user to pick a branch — it presents one **Remove** control on every resource type tested (donor, user), and the confirm modal itself states the rule rather than a specific outcome:

> **"Remove `<name>`?" — "R3 keeps it if anything points at it, and deletes it if nothing does. You'll see which happened."**

- **No-history branch (donor):** created a throwaway "QA Throwaway Donor," removed it. Toast: *"QA Throwaway Donor is gone. Nothing in R3 pointed at it."* Donor disappeared entirely from the list (hard delete).
- **History branch (donor):** removed **Riverside Market** (the highest-volume seeded donor, with completed-run weight history). Toast: *"Riverside Market is off the pickup lists. Past runs still show it."* The donor **stayed visible** in the Donors list with a **Deactivated** chip, distinct from the hard-delete outcome. **This donor is left deactivated at the end of this pass** — donors are not on the "do not deactivate" protected list in the brief (only accounts/routes/categories are), and the toast confirms past runs/reports still resolve it; flagging here so later passes aren't surprised to see it archived, and it can be reactivated via the "In use / Deactivated" toggle on its edit screen if that turns out to matter for Pass 5's report checks.
- **No-history branch (user):** created a colliding-name throwaway account (`karendiaz2`, see I3 below), then removed it as cleanup. Toast: *"Karen Diaz's account is gone. Nothing in R3 pointed at it."* Same pattern, same copy shape, confirming the mechanism is generic across resource types, not donor-specific.
- Both confirm modals: Cancel is the calm default (white/secondary), Remove is red/destructive, consequence named before the click — matches the component contract.
- **Trucks tab** already ships a pre-existing example of the archived state ("Old Van," chip "Inactive") — consistent with the pattern seen live in this pass.

### PII / accounts, general
- **I3 — username generation and collision handling, confirmed exact.** Creating "Karen Diaz" a second time (a real collision against the seeded `karendiaz`) generated preview `karendiaz2` on the S1.8 form; after Add, `GET /api/users` showed the server persisted the **exact same** `karendiaz2` — the client preview and server generator agree (`A146`).
- **Password reset control confirmed present** on Staff/Admin accounts: "Their password" text field with hint "Leave it blank to keep the password they have." No self-service reset link, no unlock/lockout-clear control anywhere on the account edit screen — matches the spec's explicit absence of both. (Viewed only; did not submit a change to Sam Okafor's real password, to avoid disrupting other passes sharing this login.)
- **PIN reset control confirmed present** on Volunteer accounts: big numeric keypad, entry blanked/hidden by default (never shows the existing PIN), hint "Leave it blank to keep the PIN they have."
- **Categories tab:** all 11 seeded AGFP categories present and untouched (Bakery, Dairy, Deli, Dry, Frozen Meat, Frz Non Meat, Health & Beauty, Non Food, Pet, Produce, Trash).

---

## The Category matching job (D12 placeholder mapping)

**Mapping editor UX:** genuinely good for a paper-first admin. Unmatched AGFP categories float to the top of the list with an orange "Not matched yet" pill; the instant a category is matched it sinks below the unmatched ones and shows `NTFB category · Storage` inline, so at any moment the screen answers "what's left to do" without scrolling or a separate report. The Storage field is a plain labeled text input directly under an explicit heading ("Storage (optional)") with inline help ("...usually Frozen, Dry or Refrigeration. Copy their wording.") — fully discoverable, no hunting. Missing storage renders as "No storage set" on the summary row rather than silently blank, which matches the spec's rule that a missing storage is named but not blocking.

The NTFB-category-creation flow was **not on the per-category matching screen** at first glance — it lives in its own "North Texas Food Bank categories" section below the AGFP list, with its own empty state ("No food bank categories yet." / "Add the categories from your North Texas Food Bank submission form. Nothing can be reported until at least one is here.") — this is a proper instructive empty state per the interaction contract, not a dead end.

**Placeholder NTFB categories created (all obviously fake):**
- `PLACEHOLDER Bakery`
- `PLACEHOLDER Dairy`
- `PLACEHOLDER Other`
- `PLACEHOLDER Produce`

**Full mapping entered (all 11 AGFP categories, per the task's final instruction to map everything and instead flag which one Pass 5 should unmap to reproduce the refusal):**

| AGFP category | NTFB category | Storage |
|---|---|---|
| Bakery | PLACEHOLDER Bakery | Dry |
| Dairy | PLACEHOLDER Dairy | Refrigeration |
| Deli | PLACEHOLDER Other | Refrigeration |
| Dry | PLACEHOLDER Other | Dry |
| Frozen Meat | PLACEHOLDER Other | Frozen |
| Frz Non Meat | PLACEHOLDER Other | Frozen |
| Health & Beauty | PLACEHOLDER Other | Dry |
| Non Food | PLACEHOLDER Other | Dry |
| Pet | PLACEHOLDER Other | Dry |
| Produce | PLACEHOLDER Produce | Refrigeration |
| Trash | PLACEHOLDER Other | (no storage set — deliberately left blank, Trash has no real NTFB storage analog) |

**Category for Pass 5 to unmap, to reproduce the export refusal:** **`Frz Non Meat`**. Rationale: it's already named in the project docs as the one that doesn't correspond to any real NTFB category on the one real receipt seen so far (`CLAUDE.md`: "our `Frz Non Meat` matches none of it"), so it is the natural, self-documenting choice to null out again. To reproduce: Admin → Category matching → Frz Non Meat → select "Leave it unmatched" → Save.

**Sanity check (read-only, no state-changing action taken):** navigated to `/report` afterward and confirmed the **Export for Meal Connect** button is enabled (no longer refusing) now that every category is mapped, and every NTFB group on the report page shows its constituent AGFP categories correctly grouped under the right placeholder name and storage. Did **not** click Export or Print/PDF (both are one-way/native-dialog actions out of scope for this pass and reserved for Pass 5).

**Open question, not a defect:** the Report screen's "Reported to North Texas Food Bank" figure for the current week (`362.54 lb`) does not match the `445.75`/`305.25`-style ground-truth figures named in `world.txt` for the equivalent week. This pass did not touch any weight entries, walk-ins, or the reportable toggle — only the NTFB mapping — so if this is a real mismatch it predates this pass. Verifying report totals against `world.txt`'s "numbers to check everything else against" is explicitly Pass 5's job per the brief; flagging here only so Pass 5 doesn't discover it cold.

---

## Untestable from here

- **True concurrent admin sessions** (e.g., two admins editing the same donor's map link at once) — single browser tab, cannot hold two logged-in sessions in parallel per the harness limitations.
- **Native file picker** — the photo upload was exercised via the `DataTransfer`-based synthetic path per the pass brief, which validates the resize/upload pipeline but not the OS-level picker chrome itself (out of scope, explicitly forbidden to click).
- **`window.print()` / Print or save as PDF** — not invoked, per the standing rule that it freezes the extension.
- **Export for Meal Connect (the actual click)** — deliberately not exercised; left enabled and ready for Pass 5, which owns testing both the refusal and the successful-export path.
