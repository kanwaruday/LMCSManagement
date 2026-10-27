# Setup quest engine (confirm values), pre-fill adapters and CampusSetup: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Lean mode: builders are Sonnet (medium), one Sonnet review per task, one Opus review at the end. No browser round
> until Task 5. Do not dispatch extra agents.

**Goal:** one shared "confirm values" setup-quest engine for every role, so a new setup quest is a block of config,
not a new codebase. A quest is a list of items (rows); each item has fields; each value is `known` (pre-filled from
our records, amber, "please confirm"), `confirmed` (a person saved it) or `skipped`. A ring per quest and per item
shows progress. Buddy lists the quests and missions, ticked from saved data only. The first real quest, Teacher T1
"Confirm what you teach", is wired end to end to prove the engine. The CampusSetup data (class sections and class
teachers, bell timings, one shared house set) ships as three inactive draft quests on the same store.

**Uday (2026-10-27, audit answers):** Principals type sections, class teachers and bells (pre-filled from
`timetable.json` where possible); one house set shared by all six campuses and HES; approval limits start blank;
"Your details" (S1) shows each person their own values only, built later on Opus; sample views now, real view-as later.

**Spec / sources:** vault `work/Role Setup Quests audit.md` (sections "Shared pieces to build once", "Missing quests",
"Prioritised build order", "View-as", "Uday's answers"); the game layer framework contract (registries are arrays per
role, `mount({only, tour})`, `peek`, `caller.idToken`, "setup is gamified"); the two implementations this generalises:
`apps-script/office-start.gs` + `office/js/starting-data.js` (Day Book) and `coordinator/capture/fleet-quests.js` +
`coordinator/capture/setup.js` (Fleet).

**Architecture:**
- **Backend: the LMCS Game Backend** (`projects.json` "game"). Reasons: it already verifies the Google token against
  the allowlist *and* signs in Teachers/Staff through the employee fallback; it already resolves a caller's employee
  code (`tchCodeFor_`) and fetches the roster and `timetable.json`; Game Config is where goals-as-config live; and Buddy's
  missions/quests hooks run in the same process (no cross-backend call per Today load, unlike Day Book's
  `caller.idToken` round trip). Rejected: a new project (a second token check, a second roster read, another deploy
  and URL to keep in sync, nothing gained); the PDR backend (no Teacher/Staff fallback sign-in, no game hooks, already
  the busiest project). Cost accepted: Game workbook writes share the one script lock (`gameWithLock_`); setup saves
  are rare and small.
- Two new server files: `apps-script/game-confirm.gs` (definitions, store, counts, actions, Buddy hooks) and
  `apps-script/game-confirm-prefill.gs` (adapters). Function prefix `cq`. Store: a new **`Setup Data`** tab in the
  Game workbook, append-only, latest row per (quest, scope, item, field) wins, exactly the Day Book rule.
- **Scopes:** a quest is `self` (one per person: T1, T2, S1), `campus` (one per school: P1, P2, P4, CFin) or
  `network` (one for everyone: P3 houses, O1, CSys). "CampusSetup" = the campus- and network-scoped rows of Setup
  Data; no second store.
- **Pre-fill is computed on read, never seeded.** An adapter returns the known rows; stored rows overlay them per field.
  Known values stay fresh from their source until a person confirms; nothing is written until a person saves.
- **Goals are config:** code ships default quest definitions (`cqDefaults_()`); Game Config key `confirmQuests`
  (`{questId: partial or full definition}`) overrides per quest, switches one off (`active:false`) or adds a new quest
  that uses existing field types and adapters, with no deploy.
- **Client:** one ES module `assets/setup/confirm-values.js` (board, quest screen, item forms, rings, offline outbox)
  and one generic page `setup/index.html?quest=<id>[&campus=..][&item=..]` that every mission and quest step links to.
  It reuses the Day Book pieces as they are: `ringSvg`/`ringModel`/`confirmLine`/`parseError` from
  `office/js/starting-data.js`, `h`/`field`/`setKids` from `office/js/dom.js`, `createOutbox` from
  `office/js/outbox.js`, `createIdbStore` from `office/js/idb-store.js`, and the `sd-*` styles from `office/office.css`.
- Static HTML/JS, no framework. Tests are Node `vm` / ESM tests run by `node tests/verify.mjs`.

**Tech stack:** Google Apps Script (V8), vanilla ES modules, IndexedDB (outbox), Node test scripts.

## Global Constraints

- **Load order (one global scope per Apps Script project, files run alphabetically):** every new `.gs` file starts with
  the guard lines `var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};`, `var GAME_MODULE_MISSIONS = ... || {};`,
  `var GAME_MODULE_QUESTS = ... || {};` and `var CQ_PREFILL = CQ_PREFILL || {};`. Top-level code holds literals and
  registrations of the file's **own** functions only; another file's symbols (`gameWithLock_`, `tchCodeFor_`,
  `TCH_ROSTER_URL`, `GAME_ALLOWLIST_SHEET_ID` …) are used only inside function bodies.
  `tests/apps-script/test-load-order.js` must pass.
- **Register with concat, never `=`:** `X.Role = [].concat(X.Role || [], fn_)`. Task 4 fixes `game-teacher.gs`, which
  still assigns `GAME_MODULE_MISSIONS.Teacher = function` and would silently drop the engine's Teacher hooks
  (`game-confirm.gs` sorts before `game-teacher.gs`).
- **Identity comes from the verified caller only.** `self` scope key = `'self:' + caller.email` (lower case). No action
  reads an email, code or scope for another person from the request. Any request carrying a non-empty `viewAs` or
  `viewAsCode` is refused (`SETUP_NO_VIEW_AS`): the game backend has no view-as and the engine never pretends to.
- **`selfOnly: true` hook (for S1, built later):** only valid with `scope:'self'`; a request for a selfOnly quest that
  carries any of `email`, `code`, `employeeCode`, `scope` is refused (`SETUP_SELF_ONLY`) before anything is read; a
  sample view of it returns its `sample` placeholders only, never adapter or stored values; adapters get
  `opts.selfOnly = true` and must not cache what they return.
- **No PII in this plan.** No adapter reads `EmpPersonal`, `EmpProfessional` or `EmpKeyNumbers` (a test asserts the
  file text). Free-text values refuse any run of 8+ digits (`SETUP_NUMBER_REFUSED`), as Day Book does.
- **Done comes from data, never a tick box.** Rings count required fields (skipped counts as confirmed); a quest is
  done when `total > 0 && confirmed === total`. An empty quest is done only through its explicit "none" item
  (`emptyLabel`, below).
- **Error shape:** `{ success:false, code:'SETUP_X', error:'SETUP_X' | 'SETUP_X: fieldId' }` (the Day Book shape, so
  `parseError` from `starting-data.js` reads it). Every `SETUP_*` code has a plain message in the client's `CODES`.
- **Copy:** Buddy's voice guide (vault `work/LMS Mascot Voice Guide.md`): plain, warm, verb first. UI words: "Confirm",
  "Save", "Known from our records · please confirm". No speed, no ranking, no timers.
- **Never change Day Book or Fleet behaviour.** Their files are imported, never edited (Task 4's `game-teacher.gs`
  change is the only edit to an existing module, and it is behaviour-neutral).
- **Synthetic test data only:** codes like `TST/99/01/001`, names like `Teacher A`, emails `@test.invalid`.
- After each task: `node tests/verify.mjs` passes; commit on branch `setup-engine` with a message ending
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (builders: use the attribution line your session gives).
  Never push or deploy without Uday's go-ahead.

## Review Focus

Per-task reviewer (Sonnet) and final reviewer (Opus) check, in this order:
1. **Self scope cannot leak:** every read and write keys `self` rows on the verified caller; no request field changes
   whose rows are read or written; selfOnly and view-as refusals happen before any read.
2. **Load order and registration:** both new files load in alphabetical and reverse order; Teacher and Staff hooks from
   `game-teacher.gs` and `game-confirm.gs` all survive in both orders.
3. **Nothing heavy under the lock:** adapters that fetch run only outside `gameWithLock_` (missions hook, actions before
   the lock); the quests hook uses the per-request memo or cache-only adapters.
4. **Latest-wins and counts match** between server (`cqCount_`) and client (`itemCounts`, `applyQueued`).
5. **A failing source never breaks Today:** hooks catch everything and never push to `down`.

---

## Shared shapes (all tasks use these exactly)

```js
// A quest definition after cqValidDef_ (defaults + Game Config `confirmQuests[id]` merged with Object.assign).
QuestDef = {
  id: 't1',                         // /^[a-z][a-z0-9_]{0,23}$/
  title: 'Confirm what you teach',  // quest heading (Buddy quest title, board card)
  task: 'Check the classes you teach', // mission title, verb first
  intro: '',                        // one line above the items ('' = none)
  roles: ['Teacher'],               // who fills: any overlap with caller.roles
  scope: 'self' | 'campus' | 'network',
  campuses: ['LMS1','LMS2','LMS3','LMS4','LMS5','LMS6'], // campus scope only; may include 'HES'
  prefill: 'roster.myClasses' | '', // a key of CQ_PREFILL, '' = typed fresh
  selfOnly: false,
  addable: true,                    // person may add items
  emptyLabel: '',                   // e.g. 'I do not teach any classes': enables the '_none' item
  skipLabel: '',                    // e.g. 'I do not teach this': enables skip on an item ('' = no skip button)
  itemTitle: '{class} · {subject}', // {fieldId} placeholders
  fields: [ { id, label, type, required, choices?, hint? } ], // id /^[a-z][A-Za-z0-9]{0,31}$/; type in CQ_TYPES
  sample: [ { item, fields: { fieldId: 'text' } } ],          // sample view only
  active: true
}
CQ_TYPES = ['text', 'choice', 'number', 'time', 'date', 'yesno']

// What setupget returns per quest (and what the hooks and client consume)
QuestView = {
  id, title, task, intro, scope, campus /* 'LMS4' | null */, selfOnly, addable, emptyLabel, skipLabel, itemTitle,
  fields /* public copy of def.fields */, draft /* true only in sample view for an inactive def */,
  items: [ { item: 'c-class7-math', fields: { class: { value: 'Class 7', status: 'known'|'confirmed'|'skipped', at?: ISO } } } ],
  ring: { confirmed, known, total, done },
  itemsDone, itemsTotal,            // items whose required fields are all confirmed/skipped; '_none' excluded from both
  prefillDown: false                // adapter missing, threw, or returned null (cold cache-only)
}

// Adapter: CQ_PREFILL[name] = function (ctx, opts) -> [{ item, fields: { fieldId: string } }] | null
//   ctx = { caller, campus /* null for self/network */, def }; opts = { cacheOnly: bool, selfOnly: bool }
//   null = source unavailable (or cache cold under cacheOnly). Never throws on purpose; the engine catches anyway.

// Setup Data tab header (positions are fixed; never reorder)
CQ_HEADER = ['Quest', 'Scope', 'Item', 'Field', 'Value', 'Status', 'Note', 'At', 'By']
// Scope: 'self:<email>' | 'campus:LMS4' | 'network'. Status: 'confirmed' | 'skipped' (never 'known': known is computed).
```

Error codes (server): `SETUP_NO_VIEW_AS`, `SETUP_SELF_ONLY`, `SETUP_SAMPLE_OWNER_ONLY`, `SETUP_SAMPLE_READ_ONLY`,
`SETUP_NOT_YOURS`, `SETUP_BAD_CAMPUS`, `SETUP_BAD_ITEM`, `SETUP_UNKNOWN_FIELD`, `SETUP_FIELD_REQUIRED`,
`SETUP_BAD_VALUE`, `SETUP_NUMBER_REFUSED`, `SETUP_NO_NONE`, `SETUP_NO_SKIP`, `SETUP_BUSY`, `SETUP_ERROR`.

---

## Task 1: Store and engine, server side (`game-confirm.gs`)

**Files:**
- Create `apps-script/game-confirm.gs`
- Edit `apps-script/game.gs`: in `gameConfigDefaults_()` add `confirmQuests: {}, // setup quests (game-confirm.gs): {questId: definition override}`
- Edit `apps-script/projects.json`: add `"game-confirm"` to `game.files` (after `"game-setup"`)
- Create `tests/game/test-confirm.js`

**Interfaces (all in `game-confirm.gs`):**
```js
var CQ_TAB = 'Setup Data';
var CQ_HEADER = [...];                 // as above
var CQ_TYPES = [...];
var CQ_CAMPUSES = ['LMS1','LMS2','LMS3','LMS4','LMS5','LMS6','HES'];
var CQ_DEFAULT_CAMPUSES = ['LMS1','LMS2','LMS3','LMS4','LMS5','LMS6'];
var CQ_MEMO = null;                    // { key: email + '|' + now.getTime(), views: QuestView[] } — one request's status
function cqErr_(code, field)           // -> Error with .code = code, .message = field ? code + ': ' + field : code
function cqFail_(err)                  // -> { success:false, code: err.code || 'SETUP_ERROR', error: err.message }
function cqDefaults_()                 // -> {} in this task (Task 5 fills it)
function cqValidDef_(id, raw)          // -> QuestDef (normalised, defaults filled) | null; logs console.error on null
function cqDefs_(cfg, includeInactive) // -> QuestDef[]: ids of cqDefaults_() first (their order), then config-only ids
function cqMine_(caller, defs)         // -> defs whose roles overlap caller.roles
function cqScopes_(caller, def, campusParam) // -> [{ scopeKey, campus }] (rules below); throws SETUP_BAD_CAMPUS
function cqRead_()                     // -> [{quest, scope, item, field, value, status, note, at}] ; [] when no tab
function cqStored_(rows, questId, scopeKey) // -> { order: [itemKey], byItem: { itemKey: { fieldId: {value, status, at} } } }
function cqKnown_(def, ctx, opts)      // -> { items: [{item, fields}], down: bool }
function cqMerge_(def, known, stored)  // -> Item[] (known order, then stored-only items in first-appearance order)
function cqItemDone_(def, item)        // -> every required field status confirmed|skipped
function cqCount_(def, items)          // -> { confirmed, known, total, done }
function cqView_(caller, def, scope, rows, opts) // -> QuestView
function cqStatus_(caller, cfg, now, opts)       // -> QuestView[] for every def of the caller x every scope; memoised in CQ_MEMO
function cqSample_(caller, cfg, role)  // -> QuestView[] from def.sample (includes inactive defs, draft:true)
function cqValue_(field, v)            // -> stored text; throws SETUP_BAD_VALUE / SETUP_NUMBER_REFUSED
function cqItemKey_(k)                 // -> k; throws SETUP_BAD_ITEM unless /^[A-Za-z0-9_:\-]{1,64}$/ and no 8+ digit run
function cqRefuse_(def, p)             // throws SETUP_NO_VIEW_AS / SETUP_SELF_ONLY per Global Constraints (def may be null)
function cqGetAction_(caller, p)       // action 'setupget'
function cqSaveAction_(caller, p)      // action 'setupsave'
function cqLoadCfg_()                  // -> gameParseConfig_(Game Config rows)
GAME_MODULE_ACTIONS.setupget = cqGetAction_;
GAME_MODULE_ACTIONS.setupsave = cqSaveAction_;
```

**Rules to implement:**
- `cqValidDef_`: reject (null) when id fails the pattern; `scope` not one of the three; `roles` not a non-empty array of
  strings; `fields` not a non-empty array; a field id fails `/^[a-z][A-Za-z0-9]{0,31}$/` (so `_`-prefixed ids are
  reserved for the engine) or repeats; a type not in `CQ_TYPES`; a `choice` field without a non-empty `choices` string
  array; `selfOnly` true with a scope other than `self`; `campuses` containing a value not in `CQ_CAMPUSES`. Fill
  defaults: `task` = `title`, `intro`/`emptyLabel`/`skipLabel`/`prefill` = `''`, `itemTitle` = `'{' + fields[0].id + '}'`,
  `campuses` = `CQ_DEFAULT_CAMPUSES`, `addable` = false, `selfOnly` = false, `active` = true, `sample` = [].
- `cqDefs_`: merged = for each id in `cqDefaults_()` then each id only in `cfg.confirmQuests`:
  `Object.assign({}, cqDefaults_()[id] || {}, (cfg.confirmQuests || {})[id] || {})`; keep valid ones; drop
  `active:false` unless `includeInactive`.
- `cqScopes_`: `self` → `[{ scopeKey: 'self:' + lower(email), campus: null }]`; `network` → `[{ scopeKey: 'network',
  campus: null }]`; `campus`: with `campusParam` (upper-cased): must be in `def.campuses` and visible to the caller
  (`gameVisibleCampuses_(caller)` is null or contains it), else `SETUP_BAD_CAMPUS` → one scope; without it: the
  caller's own `campusId` if in `def.campuses` → one scope; else, network-wide caller (`gameVisibleCampuses_` null) →
  one scope per `def.campuses`; else `[]`.
- `cqKnown_`: no `def.prefill` → `{items:[], down:false}`; adapter missing → `{items:[], down:true}`; call in
  try/catch; `null` or throw → `{items:[], down:true}`; keep only rows whose item passes `cqItemKey_` (drop, don't
  throw) and only fields that exist on the def; values `String(v).trim()`.
- `cqMerge_`: a known field with a non-empty value becomes `{value, status:'known'}`; a stored field replaces it
  (latest row in sheet order wins); stored values of `number` fields are returned as text like the rest.
- `cqCount_` / `itemsDone`: Day Book rule (required fields only, skipped counts as confirmed), `done = total > 0 &&
  confirmed === total`. The `'_none'` item counts in the ring (its required fields are skipped) but not in
  `itemsDone/itemsTotal`.
- `cqStatus_(caller, cfg, now, opts)`: if `CQ_MEMO && CQ_MEMO.key === lower(email) + '|' + now.getTime()` return its
  views; else read rows once (`cqRead_`), build views for `cqMine_(caller, cqDefs_(cfg))` x `cqScopes_(caller, def,
  null)`, store in `CQ_MEMO`, return. `opts.cacheOnly` is passed to adapters. Returns `[]` without reading the tab when
  the caller fills no quest.
- `cqGetAction_(caller, p)`: try { `cqRefuse_(null, p)`; if `p.sample === '1' || p.sample === true`: Owner only
  (`caller.roles` has `'Owner'`) else `SETUP_SAMPLE_OWNER_ONLY`; return `{success:true, sample:true, quests:
  cqSample_(caller, cfg, String(p.role || ''))}`. Else defs = `cqMine_(caller, cqDefs_(cfg))`; with `p.quest`: the def
  with that id or `SETUP_NOT_YOURS`; `cqRefuse_(def, p)`; views = its scopes (with `p.campus`) built with
  `cqView_`; without `p.quest`: `cqStatus_(caller, cfg, gameNow_(), {})` (selfOnly quests never get a campus param, so
  this is safe). Return `{success:true, sample:false, quests: views}` } catch → `cqFail_`.
- `cqSaveAction_(caller, p)`: everything validated **before** the lock:
  `p.sample` truthy → `SETUP_SAMPLE_READ_ONLY`; `cqRefuse_(null, p)`; def from `p.quest` among the caller's active defs
  or `SETUP_NOT_YOURS`; `cqRefuse_(def, p)`; scope = the single scope from `cqScopes_(caller, def, p.campus)` (a
  network-wide caller saving a campus quest must name `campus`; zero or several scopes → `SETUP_BAD_CAMPUS`); key =
  `cqItemKey_(p.item)`; current view = `cqView_` (adapter runs here, outside the lock).
  - `p.item === '_none'`: needs `def.emptyLabel` (else `SETUP_NO_NONE`) and `p.skip === true`; writes every field `''`
    `skipped`.
  - `p.skip === true` on another item: needs `def.skipLabel` (else `SETUP_NO_SKIP`) and the item must exist in the
    current view (else `SETUP_BAD_ITEM`); writes every field `''` `skipped`.
  - otherwise: the item exists in the view, or `def.addable` (else `SETUP_BAD_ITEM`); each key of `p.fields` must be a
    def field (else `SETUP_UNKNOWN_FIELD`) and passes `cqValue_`; after the save every required field must be non-empty
    counting the existing non-skipped values (else `SETUP_FIELD_REQUIRED` with the field id); writes the sent fields
    **plus** every required field that is currently `known` (its known value), all `confirmed`. This makes "Confirm"
    with untouched amber values a one-tap save.
  - `note` = `cqValue_({id:'note', type:'text'}, p.note)`.
  - Then `gameWithLock_(…)`: `cqEnsureTab_(gameBook_())` (creates `Setup Data` with `CQ_HEADER` through
    `gameAppendText_` when missing), append one row per field `[quest, scopeKey, item, field, value, status, note,
    now.toISOString(), lower(email)]` with `gameAppendText_`. A lock timeout (throw from `waitLock`) →
    `SETUP_BUSY`, nothing written. Set `CQ_MEMO = null`.
  - Return `{success:true, saved: <item from a fresh cqView_>, ring, itemsDone, itemsTotal}`.
- `cqValue_`: `''`/null/undefined → `''`. `text`: trim, at most 200 chars (else `SETUP_BAD_VALUE`), `/\d{8,}/` →
  `SETUP_NUMBER_REFUSED`. `choice`: in `choices`. `number`: `/^\d{1,6}$/` → `String(Number(s))`. `time`:
  `/^([01]?\d|2[0-3]):([0-5]\d)$/` → zero-padded `HH:MM`. `date`: `YYYY-MM-DD` and a real date. `yesno`: `yes`|`no`.
- `cqSample_`: for each def (`includeInactive`) whose roles include `role`: a view with `items` from `def.sample`
  (every non-empty value `known`), never calling adapters or `cqRead_`; `draft: !def.active`; scope key/campus null.

**Tests (`tests/game/test-confirm.js`)** — harness: copy `tests/game/test-teacher-plans.js` lines 1–30 (fake book with
`fakeSheet`, `CacheService`, `PropertiesService`, `LockService` recording `lock`/`unlock`), load `game-confirm.gs`,
`game.gs`, `game-actions.gs`, `game-missions.gs`; `ctx.gameNow_ = () => NOW`; `book.tabs['Game Config']` holds
`[['Key','Value'], ['confirmQuests', JSON.stringify(DEFS)]]` where `DEFS` are synthetic: `tq` (self, roles Teacher,
fields `class` text req + `subject` text req, `addable`, `emptyLabel`, `skipLabel`, `prefill:'test.rows'`), `cq2`
(campus, roles Principal, fields `period` number req + `start` time req), `nq` (network, roles Principal, field
`name` text req), `sq` (self, `selfOnly`, field `phone` text req, `sample:[{item:'s1',fields:{phone:'98xxx'}}]`).
Register `ctx.CQ_PREFILL['test.rows'] = (c, o) => …` returning two rows.
- [ ] `cqValidDef_ rejects bad definitions`: each of bad id, scope `'school'`, `roles:[]`, field id `'_x'`, duplicate
  field id, type `'money'`, choice without choices, selfOnly with campus scope, campuses `['LMS9']` → `null`; a minimal
  valid def comes back with `task === title`, `itemTitle === '{class}'`, `active === true`.
- [ ] `config merges over defaults and active:false hides`: `ctx.cqDefaults_ = () => ({tq: {...}})` and config
  `{tq:{active:false}}` → `cqDefs_(cfg)` has no `tq`; `cqDefs_(cfg, true)` has it.
- [ ] `cqValue_ per type`: `'9:05'` time → `'09:05'`; `'24:00'` → throws `SETUP_BAD_VALUE`; `'012'` number → `'12'`;
  text `'A/c 123456789'` → `SETUP_NUMBER_REFUSED`; choice outside list → `SETUP_BAD_VALUE`; `'2026-02-30'` date → bad.
- [ ] `merge: known, then stored wins, latest row wins`: adapter rows `a`,`b`; stored rows confirm `a.class` twice
  with different values → value of the second row, status `confirmed`; stored-only item `n-1` appears after `a`,`b`;
  a known field with value `''` is absent.
- [ ] `counts: required only, skipped counts, empty is not done`.
- [ ] `setupget scopes`: Teacher gets `tq` (and not `cq2`/`nq`); `{quest:'cq2'}` as Teacher → `SETUP_NOT_YOURS`;
  Principal `campusId:'LMS4'` gets `cq2` with `campus:'LMS4'`; `{quest:'cq2', campus:'LMS2'}` as that Principal →
  `SETUP_BAD_CAMPUS`; Owner (roles `['Owner','Principal']`, campusId `ALL`) gets six `cq2` views LMS1–LMS6;
  `{viewAsCode:'TST/99/01/002'}` → `SETUP_NO_VIEW_AS`.
- [ ] `setupsave confirm writes rows under the lock`: confirm item `a` sending only `{class:'Class 7'}` → `Setup Data`
  created with `CQ_HEADER`; rows for `class` and the known `subject`, both `confirmed`, `By` = caller email lower case,
  Scope `self:teacher-a@test.invalid`; events `['lock','unlock']`; ring `confirmed` = 2.
- [ ] `setupsave refusals write nothing`: missing required on a new item → `SETUP_FIELD_REQUIRED: subject`; field
  `grade` → `SETUP_UNKNOWN_FIELD`; new item with `addable:false` → `SETUP_BAD_ITEM`; `skip` on unknown item →
  `SETUP_BAD_ITEM`; `'_none'` on a def without `emptyLabel` → `SETUP_NO_NONE`; `sample:true` → `SETUP_SAMPLE_READ_ONLY`;
  after all of them the tab has only the header (or does not exist).
- [ ] `_none makes an empty quest done`: adapter returns `[]`; save `{item:'_none', skip:true}` → ring done,
  `itemsTotal === 0`.
- [ ] `self rows are per person`: Teacher A confirms; Teacher B's `setupget` shows `a` as `known`, not confirmed;
  a save by A with `email:'b@test.invalid'` on non-selfOnly `tq` still writes Scope `self:a…` (field ignored).
- [ ] `selfOnly refuses identity params before reading`: wrap `ctx.cqRead_` to count calls; `setupget {quest:'sq',
  email:'x'}` and `setupsave {quest:'sq', code:'x', …}` → `SETUP_SELF_ONLY`, read count 0, no rows.
- [ ] `sample view`: Owner `{sample:'1', role:'Teacher'}` → views from `sample` only, `cqRead_` count 0, adapter
  count 0; a stored `sq` row for the Owner never appears; non-Owner → `SETUP_SAMPLE_OWNER_ONLY`; inactive def has
  `draft:true`.
- [ ] `lock timeout is SETUP_BUSY`: `waitLock` throws → `SETUP_BUSY`, no rows.
- [ ] `missing adapter is prefillDown`: def with `prefill:'nope'` → `prefillDown:true`, stored items still returned.
- [ ] `memo`: `cqStatus_(caller, cfg, NOW)` twice → adapter called once; a save resets `CQ_MEMO`.

- [ ] Run `node tests/game/test-confirm.js` then `node tests/verify.mjs`; commit `Setup quest engine: store and actions (game-confirm.gs)`.

---

## Task 2: Pre-fill adapters (`game-confirm-prefill.gs`)

**Files:**
- Create `apps-script/game-confirm-prefill.gs`
- Edit `apps-script/projects.json`: add `"game-confirm-prefill"` to `game.files` after `"game-confirm"`
- Create `tests/game/test-confirm-prefill.js`

**Interfaces:**
```js
var CQ_PREFILL = CQ_PREFILL || {};
var CQ_ROSTER_TTL_S = 1800, CQ_TT_TTL_S = 21600;
function cqSlug_(s)                // lower case, keep [a-z0-9], cut to 24 chars ('Class 11 (Arts)' -> 'class11arts')
function cqClock_(s)               // '9:20' -> '09:20'; '01:15' -> '13:15'; '12:40' -> '12:40'; bad -> ''
function cqRosterRows_(code, cacheOnly) // -> [{class, subject}] for one employee code | null
function cqTimetable_(cacheOnly)        // -> true when the slices are cached (fetches when allowed) | false
function cqPrefillMyClasses_(ctx, opts) // 'roster.myClasses'  (T1)
function cqPrefillMyPeriods_(ctx, opts) // 'timetable.myPeriods' (T2, later)
function cqPrefillBells_(ctx, opts)     // 'timetable.bells'   (P2)
function cqPrefillClasses_(ctx, opts)   // 'timetable.classes' (P1)
function cqPrefillAllowlist_(ctx, opts) // 'allowlist.people'  (O2, later)
CQ_PREFILL['roster.myClasses'] = cqPrefillMyClasses_;   // ...and the other four, same file only
```

**Rules:**
- `roster.myClasses`: code = `tchCodeFor_(ctx.caller)`; no code → `[]`. `cqRosterRows_`: cache key
  `'cq_acad_' + code`; on a miss, if `cacheOnly` → `null`; if marker `cq_acad_built` exists → `[]` (built, this
  code has no rows); else fetch `TCH_ROSTER_URL + '?action=roster'` (public; `muteHttpExceptions`), on non-200/bad
  JSON/`success:false` → `null`; group `rows` by `employeeCode` into `[{class, subject}]`, `putAll` every code's list
  (chunks of 20, `CQ_ROSTER_TTL_S`), then `cq_acad_built`. Items: `{ item: 'c-' + cqSlug_(class) + '-' +
  cqSlug_(subject), fields: { class, subject } }`, de-duplicated by item key, roster order.
- `cqTimetable_`: marker `cq_tt_built`; on a miss and not `cacheOnly`, fetch `TCH_TIMETABLE_URL`, and cache slices
  (`CQ_TT_TTL_S`): `cq_tt_bells_<campus>` = `campusPeriodSchedule[campus]`, `cq_tt_classes_<campus>` = distinct
  non-empty `class` names of that campus's periods, `cq_tt_code_<code>` = that teacher's non-free periods
  `[{day, period, class, subject, start, end}]`; then the marker. Failure → `false`, nothing cached.
- `timetable.bells` (`ctx.campus`): slice missing after `cqTimetable_` → `[]` if built (e.g. LMS 1 has no
  timetable), `null` if not built. Items `{ item: 'p' + period, fields: { period: String(period), start:
  cqClock_(start), end: cqClock_(end) } }`.
- `timetable.classes` (`ctx.campus`): items `{ item: 'k-' + cqSlug_(class), fields: { class } }`, sorted by the first
  number in the name, then by name (`Class 9` before `Class 10`; names without a number last).
- `timetable.myPeriods`: code via `tchCodeFor_`; items `{ item: day.toLowerCase() + '-' + period, fields: { day,
  period: String(period), class, subject, start: cqClock_(start), end: cqClock_(end) } }`.
- `allowlist.people`: read `SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0]` values (no cache: the same
  cheap read auth does); rows with an email; filter `campusId === ctx.campus` when `ctx.campus` is set; items
  `{ item: 'a-' + cqSlug_(email), fields: { name, email, campus: campusId, roles: roles split and re-joined ', ' } }`.
- `cqClock_`: parse `H:MM`/`HH:MM`; hour 1–6 → +12. `// ponytail: 12-hour times without am/pm read as a 07:00–18:59
  school day; a 7 pm event would read wrong. Store am/pm in the timetable extractor if that ever matters.`
- Every adapter: `opts.cacheOnly` → never calls `UrlFetchApp`.

**Tests (`tests/game/test-confirm-prefill.js`)** — harness like `tests/game/test-daybook.js` lines 1–20 (recording
`UrlFetchApp`, Map-backed `CacheService` with `putAll`/`getAll`), load `game-confirm-prefill.gs`, `game-confirm.gs`,
`game-teacher.gs`, `game.gs`. Stub `ctx.tchCodeFor_ = (c) => c.employeeCode || ''`. Synthetic fixtures inline:
roster rows for `TST/99/01/001` (Class 7 Math, Class 7 Math duplicate, Class 8 Science) and `TST/99/01/002`; a
timetable with `campusPeriodSchedule.LMS4` (periods 1, 6 at `'12:40'`–`'01:15'`, 9 at `'2:25'`–`'3:00'`) and two
teachers' periods including a free one and a `''` class.
- [ ] `roster.myClasses fetches once for everyone`: URL `=== TCH_ROSTER_URL + '?action=roster'`; teacher 001 gets
  items `['c-class7-math','c-class8-science']`; a second call and teacher 002's call make no fetch; a code with no
  rows → `[]` with no fetch.
- [ ] `roster.myClasses cache-only and failures`: cold cache + `cacheOnly` → `null`, 0 fetches; HTTP 500 → `null`,
  nothing cached (the next call fetches again); caller without a code → `[]`.
- [ ] `timetable.bells normalises clock times`: LMS4 → `p1 09:20–10:00`, `p6 12:40–13:15`, `p9 14:25–15:00`;
  `LMS1` → `[]`; cold + `cacheOnly` → `null`.
- [ ] `timetable.classes is distinct and ordered`: `''` dropped, `Class 9` before `Class 10`.
- [ ] `timetable.myPeriods drops free periods`: item ids `mon-1`…, fields include `start`/`end`.
- [ ] `allowlist.people filters by campus`: fake sheet rows; `ctx.campus = 'LMS4'` keeps LMS4 rows only; roles
  `'Principal,Teacher'` → `'Principal, Teacher'`.
- [ ] `registry is exactly the reviewed five`: `Object.keys(ctx.CQ_PREFILL).sort()` deep-equals
  `['allowlist.people','roster.myClasses','timetable.bells','timetable.classes','timetable.myPeriods']`.
- [ ] `no PII tab is ever named`: the file text of `game-confirm-prefill.gs` and `game-confirm.gs` contains none of
  `EmpPersonal`, `EmpProfessional`, `EmpKeyNumbers`.
- [ ] Run, `node tests/verify.mjs` (load order included); commit `Setup quest engine: pre-fill adapters`.

---

## Task 3: Client confirm-values module and the generic setup page

**Files:**
- Create `assets/setup/confirm-values.js` (ES module)
- Create `setup/index.html`
- Edit `tools/stamp-assets.mjs`: add `'setup/index.html'` to `PAGES`; then run `node tools/stamp-assets.mjs`
- Create `tests/game/test-confirm-view.js`

**Interfaces (`confirm-values.js`):**
```js
import { ringSvg, ringModel, confirmLine, parseError } from '../../office/js/starting-data.js';
import { h, field, setKids } from '../../office/js/dom.js';
import { createOutbox } from '../../office/js/outbox.js';
import { createIdbStore } from '../../office/js/idb-store.js';
export const CODES = { SETUP_NO_VIEW_AS: '…', /* one plain sentence per server code, plus OFFLINE */ };
export const SETUP_TOUR_BEATS = [
  { target: '#cq-board', text: 'Here is what we already know about you and your school. Check each one.' },
  { target: '.sd-ring', text: 'The ring fills as you confirm. Amber stripes are things we found in our records, waiting for your check.' },
  { text: 'Amber fields come from our records. Confirm them if they are right, or fix them and save.' },
];
export function fillTitle(template, item)          // '{class} · {subject}' + item -> 'Class 7 · Math'; blanks -> 'New entry'
export function itemModel(quest, item)             // -> [{id,label,type,required,choices,hint,value,known}] (skipped -> value '')
export function itemCounts(quest, item)            // -> {confirmed, known, total} (required fields; skipped counts)
export function savePayload(quest, key, values, model) // -> {ok:true, data:{quest, item, fields, campus?}} | {ok:false, code, field}
export function applyQueued(quest, entries)        // -> quest copy with my queued setupsave entries overlaid + ring/itemsDone recomputed
export function parseLink(search)                  // -> {quest, campus, item, sample, role}
export function newItemKey(now)                    // -> 'n-' + Number(now).toString(36)
export async function mountConfirmQuests(root, { session, backendUrl, link, onLoaded })
```
- `savePayload` mirrors the server: required empty → `SETUP_FIELD_REQUIRED`; `number` `/^\d{1,6}$/`; `time`
  `/^([01]?\d|2[0-3]):[0-5]\d$/`; `date` `YYYY-MM-DD`; `choice` in list; `text` with `/\d{8,}/` →
  `SETUP_NUMBER_REFUSED`; any failure → `SETUP_BAD_VALUE` with the field. Sends a field when it has text or had a value
  before; adds `campus: quest.campus` only when `quest.scope === 'campus'`.
- `applyQueued`: entries are outbox entries (`{action:'setupsave', data, status}`) owned by me; for each in seq order
  matching `data.quest === quest.id` (and `data.campus` when campus scope): skip → every field `{value:'', status:
  'skipped', pending:true}`; else each sent field `confirmed` + the item's remaining `known` required fields
  `confirmed` (the server's rule), `pending:true`; a new item key is appended. Recompute `ring` (via `itemCounts`) and
  `itemsDone`/`itemsTotal`.
- `parseLink`: `quest` `/^[a-z][a-z0-9_]{0,23}$/`, `campus` upper-cased `/^(LMS[1-6]|HES)$/`, `item`
  `/^[A-Za-z0-9_:\-]{1,64}$/`, `sample` `=== '1'`, `role` `/^[A-Za-z]{1,20}$/`; anything else `null`/false.
- `mountConfirmQuests`: GET `backendUrl?action=setupget&idToken=…[&quest=][&campus=][&sample=1&role=]`
  (`cache:'no-store'`). Screens as a history stack like `starting-data.js` (`pushState`, Back pops): **board**
  (`<ul id="cq-board" class="sd-cards">`: one `sd-card` per QuestView with `ringSvg(ring)`, title, `confirmLine`,
  campus label when `campus`) → **quest** (title, intro, one `<form class="office-form sd-item">` per item:
  `itemModel` fields, amber `sd-known` + tag "Known from our records · please confirm" exactly as `starting-data.js`
  `itemForm` does; button reads **Confirm** while any known value is untouched, else **Save**; a `skipLabel` button;
  `+ Add` when `addable`; when there are no items and `emptyLabel`, one button with that label sending
  `{item:'_none', skip:true}`). A deep link with `quest` opens that quest; with `item`, scrolls to and focuses it.
- **Saves are offline-tolerant:** `createOutbox({ store: createIdbStore('lmcs-confirm', 'outbox'), api: { write },
  who: () => email })`, where `write(action, data)` POSTs `JSON.stringify({ action, idToken, ...data })` (no
  Content-Type) and returns the JSON, or `{success:false, network:true}` on a fetch failure. A save:
  `outbox.enqueue('setupsave', p.data)` → redraw with `applyQueued` (so the ring moves at once) → `flush()`. A
  status bar shows "N saved on this phone, waiting to send · **Send now**" (calls `flush`) and attention entries with
  their `CODES` message and **Fix** (reopens the item) / **Discard**. On `online` and after each flush with zero
  waiting: re-GET. Auth failure (outbox `authRequired`) → "Sign in again to send your saved answers." Same ownership
  rule as Day Book's outbox: another person's waiting saves on a shared phone show as a count only.
- **Sample view** (`link.sample`): a banner "Sample view · nothing here is real and nothing saves", all controls
  disabled, no outbox.
- Every server string reaches the DOM through `h()` text nodes only.

**`setup/index.html`:** copy the head, gate and session code of `teacher/plan-activity.html` (lines 1–37 and the
`LMCS.getSession() ? … : LMCS.requireSession('#lmcs-gate-slot')` block); title `LMCS — Setup`; stylesheets
`../assets/style.css`, `../office/office.css`, `../assets/game/game.css`; scripts `../assets/auth.js`,
`../assets/game/game.js`; markup: a `.bar` "Setup", `<section id="game-root" hidden>`, `<main id="cq-root">`, a
"Back to my page" link to `../index.html`. A module script: `const GAME_BACKEND_URL = '<same value as
office/js/config.js>'`; once the session is ready: `mountConfirmQuests(root, { session, backendUrl, link:
parseLink(location.search) })`, then the guarded Buddy mount `LMCSGame.mount(document.getElementById('game-root'),
{ session, backendUrl: GAME_BACKEND_URL, root: '../', only: 'cq', title: 'Setup', tour: { id: 'setup-confirm',
beats: SETUP_TOUR_BEATS } })` inside try/catch (the `starting-data.js` `mountBuddy` pattern); skip the Buddy mount in
sample view.

**Tests (`tests/game/test-confirm-view.js`)** — the ESM pattern of `tests/office/test-starting-data-view.js` (async
IIFE, `await import('../../assets/setup/confirm-values.js')`):
- [ ] `fillTitle`: `'{class} · {subject}'` → `'Class 7 · Math'`; all blank → `'New entry'`.
- [ ] `itemModel`: `known` true only for status `known`; skipped field value `''`.
- [ ] `savePayload`: missing required → `{ok:false, code:'SETUP_FIELD_REQUIRED', field:'subject'}`; time `'9:5'` →
  `SETUP_BAD_VALUE`; text `'123456789'` → `SETUP_NUMBER_REFUSED`; campus included only for campus scope.
- [ ] `applyQueued`: a confirm entry turns the item's known required fields `confirmed` + `pending`, ring
  `confirmed` rises by the item's required count; a skip entry → all `skipped`; another quest's entry is ignored; a new
  key is appended.
- [ ] `itemCounts` equals the server's `cqCount_` on the same item: load `apps-script/game-confirm.gs` into a `vm`
  context and compare on three fixture items (known, mixed, skipped).
- [ ] `parseLink`: `'?quest=t1&campus=lms4&item=c-x'` → `{quest:'t1', campus:'LMS4', item:'c-x', sample:false,
  role:null}`; `'?quest=T1;&campus=LMS9'` → nulls.
- [ ] `CODES covers every server code`: every `'SETUP_[A-Z_]+'` literal in `apps-script/game-confirm.gs` is a key of
  `CODES`.
- [ ] `the page is wired`: `setup/index.html` text contains the `GAME_BACKEND_URL` value from `office/js/config.js`,
  `only: 'cq'`, `tour:` and `'setup/index.html'` is in `tools/stamp-assets.mjs` `PAGES`.
- [ ] Run, `node tools/stamp-assets.mjs --check`, `node tests/verify.mjs`; commit `Setup quest engine: confirm-values client and setup page`.

---

## Task 4: Buddy integration (missions, quests, the Teacher hook fix)

**Files:**
- Edit `apps-script/game-confirm.gs`: add the two hooks and their registration
- Edit `apps-script/game-teacher.gs`: named hooks + concat registration (behaviour-neutral)
- Edit `tests/game/test-teacher-missions.js`, `tests/game/test-teacher-quests.js`: call the named hooks
- Create `tests/game/test-confirm-buddy.js`

**Interfaces:**
```js
var CQ_HOOK_ROLES = ['Owner', 'Coordinator', 'Principal', 'Teacher', 'Staff', 'FeeClerk', 'Accounts'];
var CQ_MAX_STEPS = 12;
function cqGo_(view, item)            // 'setup/index.html?quest=' + id + (campus ? '&campus=' + campus : '') + (item ? '&item=' + encodeURIComponent(item) : '')
function cqMissions_(caller, cfg, now)  // outside the lock: warms CQ_MEMO; never throws
function cqQuests_(caller, cfg, now, opts) // under the lock: memo, else cache-only adapters; never throws
CQ_HOOK_ROLES.forEach(function (r) {  // own functions only: allowed at top level
  GAME_MODULE_MISSIONS[r] = [].concat(GAME_MODULE_MISSIONS[r] || [], cqMissions_);
  GAME_MODULE_QUESTS[r] = [].concat(GAME_MODULE_QUESTS[r] || [], cqQuests_);
});
```
- `cqMissions_`: `try { views = cqStatus_(caller, cfg, now, {}) } catch → console.error, return []`. Per view:
  skip when `ring.total === 0 && !emptyLabel`; else `gameMission_('cq_' + id, scope === 'self' ? 'me' : campus ||
  'network', { title: task, why: title + (campus ? ' · ' + gameCampusLabel_(campus) : ''), owner: caller.email,
  campus: campus || '', go: cqGo_(view), progress: itemsTotal ? { done: itemsDone, total: itemsTotal } : undefined,
  done: ring.done, core: false, shared: scope !== 'self' })`. Done missions stay in the list (Day Book's reason: a
  mission finished today still shows as done today).
- `cqQuests_`: `views = cqStatus_(caller, cfg, now, { cacheOnly: true })` in try/catch (→ `[]`). Per view: `{ questId:
  'cq:' + id + (campus ? ':' + campus : ''), title: title + (campus ? ' · ' + gameCampusLabel_(campus) : ''),
  parallel: true, steps, complete: ring.done }`; steps = items except `'_none'`, each `{ id: item, title:
  fillTitle-equivalent on the server (same `{fieldId}` rule; blanks → 'New entry'), go: cqGo_(view, item), done:
  cqItemDone_(def, item), locked: false }`; more than `CQ_MAX_STEPS` items → the first 11 plus `{ id: '_more', title:
  '+' + (n - 11) + ' more', go: cqGo_(view), done: ring.done, locked: false }`; no items → one step `{ id: 'start',
  title: task, go: cqGo_(view), done: ring.done, locked: false }`. Hooks never write (peek-safe by construction).
  `// ponytail: steps capped at 12; the page shows them all.`
- `game-teacher.gs`: rename `GAME_MODULE_MISSIONS.Teacher = function (caller, cfg, now) {` →
  `function tchMissionsHook_(caller, cfg, now) {`; `GAME_MODULE_QUESTS.Teacher = function (caller, cfg, now, opts) {`
  → `function tchQuestsHook_(caller, cfg, now, opts) {`; `GAME_MODULE_MISSIONS.Staff = function (caller, cfg, now) {`
  → `function tchStaffMissionsHook_(caller, cfg, now) {`; delete `GAME_MODULE_QUESTS.Staff = function () { return
  []; };` (no hooks = no quests). Add at the end of the file's registration area:
  `GAME_MODULE_MISSIONS.Teacher = [].concat(GAME_MODULE_MISSIONS.Teacher || [], tchMissionsHook_);`, the same for
  `GAME_MODULE_QUESTS.Teacher` (`tchQuestsHook_`) and `GAME_MODULE_MISSIONS.Staff` (`tchStaffMissionsHook_`). Leave
  `GAME_MODULE_DONE_AT.Teacher` as it is (no other module registers DONE_AT). Update comments that name the old
  assignments.
- Teacher tests: replace `ctx.GAME_MODULE_MISSIONS.Teacher(` with `ctx.tchMissionsHook_(`,
  `ctx.GAME_MODULE_QUESTS.Teacher(` with `ctx.tchQuestsHook_(`, `ctx.GAME_MODULE_MISSIONS.Staff(` with
  `ctx.tchStaffMissionsHook_(`; the `typeof … === 'function'` lines become
  `assert.ok(ctx.gameModuleHooks_(ctx.GAME_MODULE_MISSIONS, 'Teacher').includes(ctx.tchMissionsHook_))` (and the quests
  equivalent); the `GAME_MODULE_QUESTS.Staff(...)` line becomes `assert.ok(!ctx.gameModuleHooks_(ctx.GAME_MODULE_QUESTS,
  'Staff').some((f) => /^tch/.test(f.name)))`. No other assertion changes.

**Tests (`tests/game/test-confirm-buddy.js`)** — Task 1's harness plus `game-teacher.gs`, `acad-episodes.gs`,
`game-confirm-prefill.gs`; defs as in Task 1 (`tq` self, `cq2` campus).
- [ ] `hooks survive either load order`: load the game project's files in alphabetical order, then in a fresh context
  in reverse order; in both, `gameModuleHooks_(GAME_MODULE_MISSIONS,'Teacher')` contains `tchMissionsHook_` and
  `cqMissions_`, Teacher quests contain `tchQuestsHook_` and `cqQuests_`, Staff missions contain
  `tchStaffMissionsHook_` and `cqMissions_`, and every role in `CQ_HOOK_ROLES` has both cq hooks.
- [ ] `mission shape`: Teacher with `tq` items `a`,`b` (one confirmed) → one mission `{id:'cq_tq:me', kind:'cq_tq',
  title:<task>, progress:{done:1,total:2}, done:false, shared:false, core:false, go:'setup/index.html?quest=tq'}`;
  confirm `b` → `done:true`; Principal LMS4 `cq2` → `id:'cq_cq2:LMS4'`, `shared:true`, go has `&campus=LMS4`.
- [ ] `empty quests`: adapter `[]` with `emptyLabel` → mission with no `progress`, `done:false`; without
  `emptyLabel` → no mission.
- [ ] `quest shape`: `questId:'cq:tq'`, `parallel:true`, step ids `['a','b']`, step `go` ends `&item=a`, step titles
  from `itemTitle`; 15 items → 12 steps, last `id:'_more'`, title `'+4 more'`; `'_none'` never a step.
- [ ] `memo and cache-only`: `cqMissions_` then `cqQuests_` with the same `now` → adapter called once; `cqQuests_`
  alone with a new `now` → adapter called with `opts.cacheOnly === true`.
- [ ] `a failing source never breaks Today`: adapter throws → `cqMissions_` returns a mission (prefill down, items from
  store) or `[]`, never throws; `cqRead_` throws → both hooks return `[]`.
- [ ] `hooks never write`: after both hooks run, `book.tabs['Setup Data']` is unchanged/absent and `LockService` saw no
  `lock` from them.
- [ ] `gameToday_ end to end`: with the Task 1 harness plus the framework tabs (`Game Daily`, `Game Progress`,
  `Game Quests`, `Game Windows`, `Game Decisions`, header rows only) and `ctx.gameLoadSources_` stubbed to `{ src:{},
  down:[] }`, a Teacher's `gametoday` response contains mission `cq_tq:me` and quest `cq:tq`; with `peek:'1'` too.
- [ ] Run `node tests/game/test-teacher-missions.js`, `node tests/game/test-teacher-quests.js`, the new test, then
  `node tests/verify.mjs`; commit `Setup quest engine: Buddy missions and quests; concat-register Teacher hooks`.

---

## Task 5: T1 end to end, and the CampusSetup drafts as data

**Files:**
- Edit `apps-script/game-confirm.gs`: fill `cqDefaults_()`
- Create `tests/game/test-confirm-t1.js`
- Create `docs/superpowers/plans/2026-10-27-setup-quest-engine-deploy.md` (deploy checklist, below)

**`cqDefaults_()` returns exactly** (copy is Buddy-voice; field `hint`s optional):
```js
{
  t1: { title: 'Confirm what you teach', task: 'Check the classes you teach',
        intro: 'These come from the staff records. Confirm each one, fix it, or tell us you do not teach it. Add any that are missing.',
        roles: ['Teacher'], scope: 'self', prefill: 'roster.myClasses', addable: true,
        emptyLabel: 'I do not teach any classes', skipLabel: 'I do not teach this', itemTitle: '{class} · {subject}',
        fields: [ { id: 'class', label: 'Class', type: 'text', required: true, hint: 'As on the timetable, like Class 7' },
                  { id: 'subject', label: 'Subject', type: 'text', required: true } ],
        sample: [ { item: 's1', fields: { class: 'Class 7', subject: 'Math' } }, { item: 's2', fields: { class: 'Class 8', subject: 'Science' } } ],
        active: true },
  p1: { title: 'Your classes and sections', task: 'Set up your class sections', roles: ['Principal'], scope: 'campus',
        prefill: 'timetable.classes', addable: true, itemTitle: '{class} {section}',
        fields: [ { id: 'class', label: 'Class', type: 'text', required: true },
                  { id: 'section', label: 'Section', type: 'text', required: true, hint: 'A, B or C. One row per section' },
                  { id: 'classTeacher', label: 'Class teacher', type: 'text', required: true, hint: 'Name as on the staff list' },
                  { id: 'strength', label: 'Students', type: 'number', required: false } ],
        sample: [ { item: 's1', fields: { class: 'Class 7', section: 'A', classTeacher: 'Teacher A', strength: '32' } } ],
        active: false },
  p2: { title: 'Bell timings', task: 'Check your bell timings', roles: ['Principal'], scope: 'campus',
        prefill: 'timetable.bells', addable: true, itemTitle: 'Period {period}',
        fields: [ { id: 'period', label: 'Period', type: 'number', required: true },
                  { id: 'start', label: 'Starts', type: 'time', required: true },
                  { id: 'end', label: 'Ends', type: 'time', required: true },
                  { id: 'days', label: 'Days', type: 'choice', required: false, choices: ['Mon–Sat', 'Mon–Fri', 'Saturday only'] } ],
        sample: [ { item: 'p1', fields: { period: '1', start: '09:20', end: '10:00' } } ],
        active: false },
  p3: { title: 'Our houses', task: 'Name the houses', intro: 'One set of houses for every school.',
        roles: ['Principal', 'Coordinator', 'Owner'], scope: 'network', addable: true, itemTitle: '{name}',
        fields: [ { id: 'name', label: 'House', type: 'text', required: true },
                  { id: 'colour', label: 'Colour', type: 'text', required: true },
                  { id: 'rule', label: 'How students are placed', type: 'text', required: false } ],
        sample: [ { item: 's1', fields: { name: 'Red House', colour: 'Red' } } ],
        active: false }
}
```
p1–p3 are **drafts**: invisible until Uday sets `{"p2":{"active":true}}` (etc.) in Game Config after reviewing them
in the sample view. Their own tasks (P1 class-teacher choices from the roster, P3's Events link) refine them later.

**Tests (`tests/game/test-confirm-t1.js`)** — Task 4's harness, real `cqDefaults_()`, no `confirmQuests` override; the
roster fetch answers synthetic rows for `TST/99/01/001` (Class 7 Math, Class 8 Science); `ctx.tchCodeFor_` stubbed.
- [ ] `defaults validate`: `cqDefs_(cfg, true)` returns `t1,p1,p2,p3` (all valid); `cqDefs_(cfg)` returns only `t1`.
- [ ] `T1 walk-through`: Teacher `setupget {quest:'t1'}` → 2 items, all `known`, ring `{confirmed:0, known:4,
  total:4, done:false}`; mission `cq_t1:me` progress `0/2`, title `'Check the classes you teach'`; `setupsave
  {quest:'t1', item:'c-class7-math'}` with no fields (pure confirm) → ring `2/4`; `setupsave {item:'c-class8-science',
  skip:true}` → ring done; mission `done:true`; quest `cq:t1` `complete:true`; `setupsave {item:'n-abc', fields:
  {class:'Class 9', subject:'Art & Craft'}}` → `itemsTotal` 3, still done.
- [ ] `T1 for a teacher with no classes`: roster has no rows for the code → mission without progress; `setupsave
  {item:'_none', skip:true}` → done.
- [ ] `CampusSetup drafts work when switched on`: config `{p2:{active:true}, p3:{active:true}}`; Principal LMS4 gets
  `p2` with bells known from the fixture timetable; Principal LMS4 saves house `Red House`; Principal LMS2's `p3`
  shows it confirmed (one shared set); a Teacher sees neither.
- [ ] `sample view for the review`: Owner `{sample:'1', role:'Principal'}` returns `p1,p2,p3` with `draft:true` and
  sample items; `{role:'Teacher'}` returns `t1` with `draft:false`.
- [ ] Run, `node tests/verify.mjs`; then the browser round: serve the repo root (`npx serve` or the existing preview
  config), open `setup/index.html?sample=1&role=Teacher` and `&role=Principal` signed in as the Owner (live backend
  only after deploy; before that, check the page renders the error state cleanly and the console has no errors).
- [ ] Write the deploy checklist file: (1) Uday's go-ahead; (2) `node tests/verify.mjs`; (3) `node apps-script/deploy.mjs
  game` (dry run), then `--push --deploy "Setup quest engine + T1"` (keeps the /exec URL; no `gameSetup` run needed:
  `Setup Data` is created on the first save and `confirmQuests` falls back to `{}`); (4) push Pages; (5) `node
  tests/verify.mjs --live`; (6) open `setup/index.html?sample=1&role=Teacher` in the browser pane, console clean;
  (7) one real Teacher (Uday picks who) opens their Buddy mission and confirms one class; check the `Setup Data` row.
- [ ] Commit `Setup quest engine: T1 Confirm what you teach, CampusSetup drafts`.

---

## What later quests need from this engine

| Quest | Uses | Still to add (in its own task) |
|---|---|---|
| T2 timetable | `timetable.myPeriods`, self scope, `addable:false` | A "link my name" step for unmatched teachers: an adapter over `tch_meta.unmatched` and a `choice` field |
| S1 your details | `selfOnly`, sample placeholders | A token-gated self-read adapter in the roster project (`caller.idToken`, never cached) and a **write sink** so bank/contact values go back to the Employee Master and are never stored in `Setup Data` (the engine today always writes `Setup Data`). Opus plan + Opus review |
| P1 sections | draft `p1`, `timetable.classes` | `choicesFrom` on a field (class teacher picked from a roster-staff adapter); maybe the approval lifecycle |
| P2 bells | draft `p2`, `timetable.bells` | Saturday pattern if Principals ask; a `setupcampus` read action when a page needs bells |
| P3 houses | draft `p3`, network scope | Link from the Events hub (CEv); captains once student data is in scope |
| P4 staff | campus scope | `roster.campusStaff` adapter (public EmpMaster columns; designation via the token-gated staff API) |
| O1 limits | network scope, no prefill (blank by Uday's answer) | A sink to Office Config `Limits` via the Office backend with `caller.idToken`, or Office reads `Setup Data` |
| O2 roles | `allowlist.people`, campus scope, roles Owner | Nothing beyond the def |
| A1 registers | campus scope | An adapter over the Office `start.export` (caller token) |
| CFin heads | campus scope | An adapter over Office Config `Collections`; the submit/approve lifecycle (copy `office-start.gs` `_state` rows; `_`-prefixed field ids are already reserved) |
| CSys, CHR, CAc, CEv | network/campus scope | Their adapters (category map moved to config; Documents tab; Course Map; calendars) |
| A per-role overview (Principal sees teachers' T1 counts) | `Setup Data` | A counts-only read action; never selfOnly quests |
| Feeding corrections back | `Setup Data` | T1 corrections to EmpAcademic: HR applies them, or the teacher index reads them (Uday's call) |

**Estimate (agent build time):** Task 1 ~0.75 d, Task 2 ~0.5 d, Task 3 ~1 d, Task 4 ~0.5 d, Task 5 ~0.5 d: about
3.25 days. Tasks 3 and 4 can run in parallel after Task 2.

*Compiled from Claude conversation, 2026-10-27. Source: game director's setup-engine design brief and the Role Setup Quests audit.*
