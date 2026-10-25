# Portal messaging: contracts, channels and the relationship map (design)

Date: 2026-10-25. Asked for by Uday ("can we also create an internal messaging system?"). Brainstormed with him in
the Portal internal messaging chat, partly relayed through the LMCS Master Agent. **Uday's decisions are marked
"Uday"; everything else is Claude's call** and open to his correction.

Status: ready for Uday's final approval (2026-10-25). All open questions answered. Nothing is built, and nothing
is built until he approves.

Builds on:
- the vault bye-law *Communication at LMS* (`LMCS Bye Laws 2026/Employee Conduct/School Rules/Communication at LMS.md`);
- the direction in the vault's `work/active/lmcs-software-platform.md`: "the whole portal becomes a game" on real
  data, real data entry, real people;
- the portal game layer design (branch `portal-game-layer-design`,
  `docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md`: Buddy, missions, help credit, team goals),
  whose framework and anti-goals this design uses rather than reinventing;
- the approved transport game design (`2026-10-25-transport-game-design.md`), for shared guardrails;
- the vault decision *Teachers' Portal owns the leave system* (leave goes through the one Approvals workflow);
- the Fee Clerk portal design (`2026-10-21-campus-office-portal-design.md`), for the planned Postgres + React move
  and its idempotent outbox.

Mock-ups (sample people only): `docs/superpowers/mockups/messaging/` — `contracts.html`, `channel.html`,
`relationship-map.html`.

## Intent and why

- **Uday:** an internal messaging system inside the LMCS portal that, in the end, takes school work off WhatsApp
  ("Replace WhatsApp for work"). It should carry Slack's way of working (channels, threads, workflows, search,
  status, huddles), "streamlining work as well", and be gamified like the rest of the portal.
- **Uday:** build all of it, but **nothing changes on day one**. Work moves from WhatsApp into the portal one thing
  at a time, when Uday decides ("presently nothing changes, we slowly keep shifting one thing at a time";
  "build all, will use and implement later").
- **Why (Claude's reading).** Today official work is split across WhatsApp groups (captured after the fact by the
  WhatsApp Hub), the per-campus Google Chat Leave spaces, email and verbal instructions. The bye-law itself warns that
  verbal instructions "can lead to communication gaps", and says significant matters go to the immediate superior
  through TPRs and registers. None of today's channels can tell whether an instruction was done, by whom, with what
  proof. The WhatsApp Hub guesses this with keyword matching ("kindly", "ok ma"). This design makes the instruction
  itself a record that is open until proof closes it.

## Goals

1. **Four kinds of on-record message** (Uday): instructions down the chain, reports up the chain, requests and
   leave, announcements.
2. **Free chat too** (Uday): one-to-one, group and channel conversation, like WhatsApp.
3. **Slack parts** (Uday): channels with threads, @mentions and reactions; workflows (make a contract from any
   message, fill-in forms in channels, reminders, scheduled messages); search, pins, saved items, a status, voice
   huddles.
4. **Phone notifications** like WhatsApp, even when the portal is closed (Uday).
5. **Voice notes with automatic transcripts**, Hindi and English (Uday).
6. **The game** (Uday): a GTA-style *phone of contracts*, and Sims-style *relationship meters* the Owner sees.
7. Works on a cheap Android phone at 375 px first, and on a desktop.

## Non-goals

- **No change on day one** (Uday). No WhatsApp group is closed and no staff member is told to switch until Uday
  moves that piece.
- **Other modules do not post into channels** (Uday did not pick "module bots"). Fleet Command, Hiring and Approvals
  keep their own screens and Buddy's Today panel. The one exception is the request/leave forms, which hand off to
  Approvals (below), because Uday picked "requests and leave" as one of the four kinds.
- No parent or student access.
- No import of WhatsApp history into the portal (Claude's call; the WhatsApp Hub keeps it).
- Not built on Apps Script (Uday; see Constraints).

## Anti-goals (a failure even if it works)

From Uday's answers, the portal game layer's anti-goals (binding here) and the transport design:

- **Scoring message volume or speed.** Sending more messages, or replying faster, must never score. The meters use
  "answered within the working day", a threshold, never "fastest".
- **Countdown clocks and breakable personal streaks.** Contracts show a real due date, not a ticking timer.
  Individuals see "closed on time 14 of 16 this month" against their own last month.
- **Peer-visible rankings of people.** Relationship meters are Owner-only (Uday). Nobody sees anyone else's on-time
  numbers.
- **"Done" without proof.** A contract closes only with the proof its sender asked for (or "nothing", if the sender
  chose that).
- **Secret surveillance.** Nothing is private (Uday), so staff must be told so plainly before their first message,
  and the bye-law must say so. A system people discover is read is worse than one they know is read.
- **A WhatsApp clone that adds a second place to check.** Until Uday moves a conversation over, the portal must not
  create duplicate work. Anything posted in the portal that also has a WhatsApp home is a failure of rollout, not a
  feature.
- **Personal data in the public repo** or in static files.

## The Communication bye-law, mapped

| Bye-law medium | What it says | Portal equivalent |
|---|---|---|
| Verbal / phone | Avoid for official purposes; can't be quoted as instruction | A huddle is never an instruction. Anything decided in one becomes a contract or a message to count |
| TPRs, circular registers | The most used official mode; everything significant to the immediate superior | **Reports up the chain** (below) and **contracts** |
| WhatsApp / instant messaging | Mass announcements, coordination between groups, escalation beyond the immediate superior, after hours | **Announcements**, **channels**, **free chat**; anyone can message anyone, so escalation is always possible |
| Email / letters / applications | Very important information and formal requests | **Requests and leave** through forms into Approvals |

When the system is live the bye-law needs an amendment (Uday's call when to make it, through the normal office-order
process): the portal becomes the official medium for each piece as it moves, and the "nothing is private" notice is
added.

## What a person sees

### 1. The phone of contracts (`contracts.html`)

The GTA V idea (Uday): your phone holds the jobs you've been given.

- **Three tabs:** Received, Job board, Sent.
- **A contract is a ticket:** who sent it (and their role), what needs doing, a real due date and time, what proof
  closes it (photo, file, note, or nothing), and the message or channel it came from.
- **Anyone can send a contract to anyone** (Uday). The receiver **accepts** or **declines with a reason**. After
  accepting they can **hand it back with a reason**. The sender sees the reason. The sender can cancel.
- **Closing a contract** means attaching the proof asked for. The sender is notified; they can reopen it within two
  working days if the proof doesn't do the job (Claude's call), which is recorded.
- **Late** contracts stay open and show "was due Sat 24/10". Nothing is wiped.
- **Making a contract:** "+ New" (four fields: to, what, due, proof), or **Make contract** on any message, which
  fills in the text and links back to the message.
- **Your own numbers:** "Closed on time this month: 14 of 16. Last month 11 of 15." Visible only to you and the
  Owner role, as private standing (Uday: "Recognition only for now"; private, like the game layer's standing).
- **Buddy's next-step bar** points at the earliest-due open contract. Each open contract is a game-layer **mission**
  (`messaging:contract:<id>`), so it competes for a Today-panel slot by real due date like any other pending work.

### 2. Channels, threads and chat (`channel.html`)

- **Channels** in three groups: **Campus** (e.g. #lms4-staff, #lms4-transport), **Departments** (the vault's seven
  department hubs plus Systems, network-wide), **Topics** (e.g. #annual-day-2026). Plus **direct messages** and
  **group DMs**.
- Who creates channels (Claude's call): the Owner, Coordinators and Principals create campus, department and topic
  channels; anyone creates DMs and group DMs. The creator is the **channel owner** and can hand that role on.
- **Threads:** replies go under the message so the channel stays readable. @mentions notify. **Reactions:** a tick
  (✓) means "seen" or "done" and is counted on announcements.
- **Composer tools:** Attach, Voice note, Form, Make contract, Announcement, Schedule.
- **Search** across every channel and DM you're in, including transcripts and file names. Pins per channel; saved
  items per person.
- **Status:** a short line (in class, on leave, on a bus, in a meeting until 11) with an optional end time. Leave
  status could later come automatically from approved leave (Claude's call: later, not v1).
- **The notice** under every composer: "Everything in the portal is on record and visible to the Owner."

### 3. Announcements

- Posted to a channel, a campus, a role, or everyone, by the Owner, Coordinators and Principals (Claude's call;
  HODs to their own department channel).
- **Read receipts:** "42 of 58 have read it" with a "see who hasn't" list for the sender.
- Optional **must acknowledge**: the reader taps ✓, which counts. Used for circulars (Claude's call).
- Pinned at the top of the channel until the sender unpins or the end date passes.

### 4. Reports up the chain

The bye-law's TPRs and circular registers.

- A **report** is a message to your **immediate superior** that is marked as a report: free text, attachments, voice.
  The superior sees it in a Reports list and acknowledges it, asks a question, or turns part of it into a contract.
- **Who is "immediate superior"** (Claude's call): the staff data's `ReportsTo` (Teacher → Principal;
  HOD → Principal; Principal → Coordinator; Coordinator → Owner/MD), with per-person overrides the Owner can set.
  **A teacher picks the recipient when sending**: their Principal (the default) or their HOD. The HOD offered is
  the HOD of the subject the teacher teaches, taken from the timetable/staff data. **HOD becomes a role** in the
  platform's staff data for this. Anyone can still message anyone, which keeps the bye-law's escalation route.
- **Not** a replacement for the Principal's Daily Report or the SS forms, which keep their own modules. If Uday
  later wants a weekly report rhythm per role, it is configured per season (game layer `Game Config`), not
  hard-coded.

### 5. Requests, leave and forms

- **Forms in channels** (Slack Workflow Builder idea): leave, repair, purchase, complaint, and others the Owner
  defines. A form has fields and a destination.
- **Leave and other formal requests go into the platform's one Approvals workflow** (vault decision: Teachers'
  Portal owns leave through Approvals, never a parallel system). **The leave form is the Teachers' Portal leave
  form**, with the same fields and bye-law leave rules, shown inside the channel. Messaging defines no leave rules
  of its own. The channel shows a card ("Casual leave, Wed 28/10,
  sent to Ritu P., Waiting") that updates as the approval moves. The reason is visible to the requester, the
  approver(s) and the Owner, not to the channel.
- **Repair, IT and similar requests go on the channel's job board** (below).

### 6. The job board

- A request posted in a channel (by form, or by "post to job board") becomes an **open contract on that channel's
  board** (Uday: "Job board").
- **Anyone who can do it claims it** (Uday), does it and posts proof. Claiming moves it to their Received tab.
- **If nobody claims it in time, the channel owner assigns it** (Uday confirmed). "In time" (Claude's call): one
  working day, or half the time to its due date if that is shorter. The channel owner gets a mission to assign it.
- **Help credit** (game layer): the person who closes someone else's request gets "You cleared 2 requests on the
  LMS 4 board today". No points.

### 7. Voice notes and transcripts

- Record and send like WhatsApp. **Transcribed automatically in Hindi and English** (Uday), searchable.
- Transcription runs on the Mac's local whisper.cpp (large-v3-turbo, already installed and verified for the
  Telegram bot) through a worker that polls the server for new notes, the same outbound-only pattern as the LM
  Studio worker (Claude's call). The note plays at once; the transcript appears when the worker gets to it
  (confirmed by Uday as part of the playback). If the Mac is off, transcripts wait.
- The transcript is labelled "automatic" and the original audio stays the record.

### 8. Huddles

- A one-tap voice call for a channel or DM, shown as a bar with who's in it (mock-up).
- **Claude's call: v1 huddles open a Google Meet link** created for that channel (Calendar API with conference
  data, which Uday can enable as the Workspace super admin; if that isn't set up, a fixed Meet link per channel),
  since every user signs in with an lms.org.in Google account and Meet already works on their phones. A built-in WebRTC call would need our own TURN
  server and is not worth it for v1. A huddle is never on record and never an instruction (bye-law): anything
  decided becomes a contract.

### 9. Phone notifications

- The portal is an **installable app** (PWA, "Add to home screen") with **web push** from our own server
  (Uday: phone notifications). No Firebase, since the platform has its own server (Claude's call).
- iPhones need iOS 16.4 or later with the app added to the home screen; Android Chrome works from the browser too.
- **What notifies** (Claude's call): DMs, @mentions, contracts sent to you or due today, replies in threads you're
  in, announcements marked must-acknowledge. Ordinary channel messages show a badge only, unless the person turns
  them on per channel.
- **Quiet hours:** per person, default 9 PM to 7 AM, with the Owner able to send one marked "urgent" through them.
  The bye-law names after-hours as a WhatsApp use, so this keeps it possible without making it the default.

### 10. The Owner's relationship map (`relationship-map.html`)

The Sims idea (Uday): relationships between people, built from what they really do.

- **Owner only** (Uday). Nobody else sees this page, any meter, or their own meter.
- **A meter per working pair** (people with on-record work between them): Healthy, Watch or Strained, over the last
  4 weeks, with an 8-week trend.
- **Built only from on-record items** (Claude's call, following the anti-goals):
  - contracts between them closed on time, and handed back with a reason;
  - reports sent up that were acknowledged or answered (and, only if a report rhythm is configured for that role,
    reports sent on that rhythm; the mock-up's "weekly reports 2 of 4 weeks" assumes one);
  - requests answered;
  - questions in threads (messages with a "?" or an @mention to the other person) answered within the working day.

  It never uses message counts, reply speed beyond the working-day threshold, or the content of free chat. The
  exact weights and the Healthy/Watch/Strained cut-offs are configured, starting with Claude's defaults, and shown
  on the page so the Owner can see why a line is red.
- **Lists beside the map:** *Not getting answers* (whose contracts, reports or questions go unanswered most) and
  *Holding the most open contracts* (possible overload). Plus one or two findings in plain words.
- **Actions:** open the late contracts, or raise a Coordinator follow-up, so a red line leads somewhere.

## Rules

- **Nothing is private** (Uday). **Everyone with the Owner role** (Uday), MD Academics included, can read every
  channel and DM and see the relationship map. "View as" is read-only inside messaging and never sends as someone
  else (Claude's call). Staff see this, naming "everyone with the Owner role" as the readers (Claude's call):
  - at first sign-in, as a one-time screen they must accept before sending anything;
  - under every composer;
  - in the Communication bye-law (amendment above).

  India's DPDP Act expects notice of what is collected and why; Uday should get the same DPDP advice the platform
  note already recommends before rollout (Claude's call, not legal advice).
- **Rollout switches** (Claude's call, from Uday's "build all, will use and implement later"). Everything ships
  **switched off**. The Owner has one screen that turns on each feature (chat, contracts, job board,
  announcements, reports, forms, voice, huddles, relationship map) for a scope: one channel, one campus, one group of
  people, or everyone. Until a feature is on for someone, they don't see it. A pilot is simply a small scope, and
  Uday picks it when he moves the first piece. The "nothing is private" screen appears the first time anything is
  switched on for a person.
- **Edits and deletes keep history.** A deleted message shows "deleted" to others; the Owner sees the original. No
  hard deletes except by the Owner for legal reasons (Claude's call).
- **Retention:** kept indefinitely for now (Claude's call), revisited with the DPDP advice.
- **Anyone can message and send a contract to anyone** (Uday).
- **Children appear only as counts** in any game view. A message may name a student where work needs it (e.g. a
  leave request for a child's escort), but no game element or meter does.

## The score

- **Contract on-time % is recognition only for now** (Uday, 2026-10-25: "Recognition only for now"). It shows only
  as the person's private standing and recognition, in line with the game layer's "no money tied to game scores".
  **After a season of real data**, Uday revisits whether it should count toward `DR Average`. Nothing in v1 feeds
  pay.
- **Contract history is an append-only event log** (sent, accepted, declined, handed back, proof added, closed,
  reopened, cancelled, each with who and when), so that if on-time % ever feeds pay, the record behind it can be
  audited (Claude's call).
- **Team goals** (game layer): e.g. "LMS 4 closes 90% of contracts on time this term", measured against its own
  target or last term, never against another campus.
- **Badges** (game layer) for first milestones: first contract closed with proof, first job-board request cleared.

## Constraints

- **Built on the Postgres + React platform, not Apps Script** (Uday: "Wait for Postgres+React"). Messaging is built
  only once that platform exists. Apps Script cannot hold open connections, has no push, and polling 170 phones
  would hit its concurrency and quota limits.
- **Standing up the platform is not part of this work.** The Postgres + React move is its own project (Fee Clerk
  portal design: "Postgres and React come later, as their own project"), and it moves the *whole* platform. So this
  design assumes that when messaging is planned, Approvals, Coordinator tasks, staff data and the game backend
  already live in the same Postgres, and the hand-offs below are ordinary same-database work, not bridges to Apps
  Script. If that turns out false, the plan must add bridges for those four hand-offs, and that is the first thing
  to check when planning.
- **Where the platform is hosted is not decided** (platform decision, not this design's). This design needs from
  it: a long-running server that can hold WebSocket (or server-sent-event) connections and send web push; Postgres;
  file storage for photos, files and voice notes; Google sign-in against the same allowlist/staff data.
- **Same sign-in and roles** as the rest of the portal: Google Identity on lms.org.in, roles Owner, Coordinator,
  Principal, Fee Clerk, Teacher (plus HOD and other staff as the platform's staff data adds them). Staff without an
  lms.org.in account come later with a phone-number sign-in (phase 6, Uday).
- **Scale:** about 170 staff across six campuses. Small for Postgres; the design does not need sharding or a
  message broker.
- **Phones:** many Principals and staff work on phones, some cheap Android ones, some on weak data. Sending must
  survive a dropped connection: an outbox with idempotent message ids, as in the Fee Clerk portal.
- **The Mac** runs transcription (and LM Studio). Anything that depends on it must degrade gracefully when it is
  off.
- **Public repo:** no message data, names or Sheet/DB ids with access in the repo.

## How it fits with what exists

- **Game layer:** open contracts and unassigned job-board items are missions; job-board clears are help credit;
  team goals and badges use the layer's framework and `Game Config`. Messaging adds no points or currency.
- **Approvals:** leave and formal-request forms create Approvals requests; the channel card mirrors their status.
- **Coordinator follow-ups:** the relationship map's "Raise a follow-up" creates a Coordinator task.
- **WhatsApp Hub:** keeps capturing WhatsApp until each group moves. When a group moves, the Hub's briefs should
  read that portal channel instead, so the Owner's daily and weekly briefs don't lose a source (Claude's call: a
  read API for the Hub's local pipeline).
- **Telegram bot:** unchanged; it is Uday's personal channel to Claude, not staff messaging.

## Phasing (suggested; the builder may reorder within the platform's plan)

All of it is built (Uday); this is only the order.

1. **Core chat:** channels, DMs, group DMs, threads, mentions, reactions, attachments, search, the installable app,
   web push, the outbox, the "nothing is private" first-sign-in screen.
2. **Contracts and the job board:** the phone of contracts, Make contract, proof, claim, assignment by channel
   owner, missions and help credit in the game layer.
3. **Announcements, reports up the chain, forms into Approvals.**
4. **Voice notes and transcripts, status, scheduled messages and reminders, huddles (Meet links).**
5. **The Owner's relationship map.** Needs a few weeks of phase 2-3 data before its meters mean anything.
6. **Staff without an lms.org.in account** (Uday: "Later, via phone sign-in"): drivers, helpers, guards and other
   staff sign in with their phone number and a one-time code, tied to their Employee Code in the staff data, and
   get the same features and the same "nothing is private" screen. Claude's calls for the builder:
   - the one-time code goes by SMS (or WhatsApp) through a paid gateway, which needs Uday's pick of provider and a
     small running cost;
   - codes are rate-limited per number, and a phone sign-in is allowed only for a number already in the staff data;
   - huddles: phone-signed-in staff join the Meet as guests, which the Workspace Meet settings must allow;
   - Fleet Command's drivers are the first group, since they are already becoming game characters there.

## Settled after the builder check (Claude's calls unless marked)

- The platform itself is a prerequisite, not part of this plan (see Constraints). Same-database hand-offs assumed.
- Rollout switches per feature and scope, everything off by default (see Rules).
- The leave form is the Teachers' Portal leave form.
- Reports: the teacher picks Principal (default) or their subject HOD. HOD becomes a role. The meters only count a
  report rhythm if one is configured.
- Contract history is an append-only event log.
- Uday is the Workspace super admin (vault, hiring calendar decision), so the Google OAuth client and Calendar/Meet
  access for a non-Apps-Script server are available. Fixed Meet links per channel are the fallback.
- **The design is not approved until Uday approves it.** The Claude's-call items above and in the body may change
  with his review, and planning waits for that.

## Open questions for Uday (one at a time, through the LMCS Master Agent)

1. ~~Mock-up feedback~~ **Answered (Uday, 2026-10-25):** "Messaging mockups look good as they are, no changes."
   The three mock-ups are the reference for the phone of contracts, a channel and the relationship map.
2. ~~Who is "the Owner" who can read everything?~~ **Answered (Uday, 2026-10-25): "Everyone with Owner role."**
   Anyone holding the Owner role, MD Academics included, can read every channel and DM and see the relationship
   map. Claude's calls that go with it: the "nothing is private" notice says plainly "everyone with the Owner role
   can read all messages"; "view as" inside messaging is read-only and can never send as someone else.
3. ~~Staff without an lms.org.in account~~ **Answered (Uday, 2026-10-25): "Later, via phone sign-in."** Phases 1-5
   are for lms.org.in staff on the allowlist only; drivers, helpers, guards and other staff join in phase 6 with a
   phone-number sign-in.
4. ~~Score vs money~~ **Answered (Uday, 2026-10-25): "Recognition only for now."** On-time % is private standing
   and recognition only; whether it counts toward `DR Average` is revisited after a season of real data.

## Left to the builder

- Database schema, API shape, real-time transport (WebSocket vs server-sent events), and the React component
  structure, within the platform's conventions.
- Search implementation (Postgres full-text plus trigram matching for Hindi and transliterated text).
- File storage and image/voice compression for weak connections.
- Exact notification text, quiet-hours behaviour details, and the defaults for relationship-meter weights and
  cut-offs (shown on the page and configurable).
- How form definitions are edited by the Owner.

*Compiled from Claude conversation, 2026-10-25. Source: Portal internal messaging brainstorm with Uday, in this chat
and relayed through the LMCS Master Agent.*
