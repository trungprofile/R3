# R3: status and review notes for Scott

Hi Scott. Here's where R3 is, how it's laid out, and what I'd like you to hammer on before we let the
pantry near it. Skim the first three sections; the part I need you on is the test list at the end.

## Where things stand

All three phases are built and working: the rescue loop and scheduling, receiving and weighing, and
the weekly report with metrics.

**It's deployed.** `rescue.amazinggracepantry.org` runs R3 in Docker on the pantry box, behind the
existing nginx. The old April prototype is retired; it had been serving a dead API for months.

What's left before a pilot:

- Database backups. There are none on the box today.
- Your review, which is what this note is for.
- The NTFB donor codes for the stores on our routes (from the [MealConnect receipt you sent on 03/24](https://amazinggracefoodpantry.sharepoint.com/:b:/r/sites/PantryDevs/Shared%20Documents/Retail%20Rescue%20Platform/MealConnect%20-%20Example%20Receipt%20002418274354.pdf?d=w9dae8e800b224e3c836330f5e7817a7d&csf=1&web=1&e=wCwTXd)). It's the one field on the receipt I can't fill in myself.

What you'll be looking at is a seeded test world, not pantry data. Break whatever you like.

## How the repo is laid out

Three npm workspaces: `shared` (types, no runtime dependencies), `server`, `client`.

```
client/src/screens/     one folder per screen, grouped by phase
client/src/components/  shared UI pieces
server/migrations/      hand written SQL, forward only, the schema authority
server/src/routes/      parse the request, declare who may call it, shape the response
server/src/services/    one function per domain operation, owns transactions, enforces the rules
server/src/jobs/        catch up sweeps, not timers
scripts/                dev, test database, seed, backup, migration rehearsal
docs/foundation/        the five specs below
```

Three conventions worth knowing before you read any of it:

1. **Schema flows one way.** SQL migration, then database, then generated TypeScript types. The
   types file is generated and never hand edited.
2. **Nothing outside `services/` opens a write transaction.** Routes and jobs both call in through
   services. That's what makes "the service layer enforces the rules" true rather than aspirational.
3. **A route that declares no permission requirement is rejected, not open.** Default deny.

Rules are enforced at the strongest layer that can express them: database constraints first,
conditional updates with rowcount checks second, service code last. Client side checks are for
communication only and are always re-checked on the server.

## The documentation

Five foundation docs. They're long and deliberately don't overlap, so read the one that owns the
area you're asking about rather than all of them.

| Doc | What it owns |
|:--|:--|
| `product-requirement.md` | The problem, the roles and duties, the numbered capabilities, phasing, success measures |
| `domain-modeling.md` | Entities, state machines, the numbered invariants, the named algorithms |
| `architecture.md` | Where each rule is enforced, auth and sessions, background jobs, deployment, operations |
| `data-model.md` | Physical schema: types, constraints, indexes, concurrency |
| `ui-ux-spec.md` | Design tokens, component contracts, every screen, the microcopy |

`domain-modeling.md` is locked and wins if two docs disagree.


## Getting in

<https://rescue.amazinggracepantry.org>

| Account | Sign in as | Credential | What it shows |
|:--|:--|:--|:--|
| Admin, all three duties | Ada Grace | `dev-password` | Everything: admin, schedule, report, and the driver and receiver screens |
| Volunteer, driver + receiver | Luis Park | `4321` | What an actual volunteer sees: no admin, no schedule |
| Volunteer, no duties | Nina Torres | `4321` | The read-only case |

Use at least the first two. Navigation shows one entry per capability you hold, so signing in as
admin alone shows you the admin's app, not the volunteer's.

Sign in is name first: pick your name off the list, then enter the credential. Volunteers use a
4 digit PIN, staff and admin use a password. Deliberate. The pantry's volunteers are older and not
comfortable with technology, and because the account is identified before the credential is checked,
rate limiting carries the load PIN complexity would elsewhere.

These are seeded test credentials, published in the repo. They get replaced before real data exists.

## What I'd like you to stress test

Roughly in priority order. The full version is `docs/features/test-plan.md`, which breaks this into
ten tracks; this is the short list of what actually worries me.

**1. The weekly cycle, end to end.** Publish a shift, claim it as a driver, run the route, weigh it
in as the receiver, then produce the report. Rule of thumb: If any step needs a phone call
or a piece of paper, the project has missed its point.

**2. The report has to match the screen.** Trash is computed rather than weighed: a share of bakery,
produce and deli weight is deducted per receipt and reported as its own food bank category. It moves
weight between categories and never changes the total. If you can make the totals on screen disagree
with the printed receipt, that's the most valuable bug you could find.

**3. Concurrency.** Two drivers claiming the same open shift at the same time. Two receivers weighing
the same run. Two reporters marking the same receipt as filed. All of these should have exactly one
winner. Everything writes at SERIALIZABLE with a retry, so I'd like to know if you can break it.

**4. Permissions.** Sign in as Luis and try to reach admin screens and other people's phone numbers,
by URL as well as by clicking. Personal data leaves through a single function, so a leak would mean
something structural is wrong.

**5. Real devices.** Drivers use phones and the dock uses a tablet. Run the driver flow on an actual
phone rather than a resized browser window. The nav bar caps at four entries on small screens by
design, so office work is reached through Home there.

**6. The awkward cases.** A pickup that produced nothing. A walk in donation with no scheduled
pickup. A driver who can't finish a run. A weight typed in wrong and corrected a week later. These
are where paper processes used to absorb the mess, and where the app has to instead.

**7. The words.** If a label or message would confuse Suzie (I forgot how to spell her name), that's
a real defect and I'd rather hear it now.

Six things look like bugs and aren't, so please skim these before filing:

- The mobile nav bar shows four entries at most. Design, not truncation.
- Metrics is a tab inside Admin, not its own page. The category mapping is a section of Admin's
  Categories tab. The receiver notification banner is mounted by the app shell.
- Nav order never reshuffles. A shorter list is the full list with rows removed, so gaining a duty
  makes a row appear in place instead of moving everything under someone.
- Report opens straight onto the receipts. There's no totals page in front of it any more, because
  a reporter who saw a totals screen treated the edit behind it as someone else's job.
- Drivers can't close their own run. Only the receiver can.
- Home is capped at seven cards and is not a duty picker.

## Filing what you find

Issues are open at <https://github.com/trungprofile/R3/issues>. Please include the screen, which
account you were signed in as, the device, and what you expected. The docs are organised by screen,
so a bug with a screen name attached is one I can go straight to.

If you'd rather do it live, an hour walking the weekly cycle together is worth more than a list.

## One ask

The box currently takes traffic through a port forward on the pantry router, a NAT rule, an nginx
with a certificate to renew, and a firewall allow list. R3 is designed to replace all four with a
Cloudflare tunnel that connects outbound from the app, which closes the inbound port for good.

That needs the Cloudflare account. If you can add me as a member, I can make that change and the ones
after it without coming back to you each time. Nothing is blocked on it today, since the deploy routes
around it, but it's a real security improvement going cheap.

One more, whenever you get to it: the tunnel token on the box was exposed in shell history by the
old setup and should be rotated from the dashboard. It only serves SSH today, not the website.

Thanks,
Trung
