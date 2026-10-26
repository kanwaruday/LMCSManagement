#!/usr/bin/env python3
"""Push the fleet roster (from the transport workbook on OneDrive) plus the document dates LM Studio read
from the Drive scans (drive-index/records.db) and the vault overrides note to the Coordinator backend, which
keeps them in the "LM Studio ..." tabs of the transport form-responses sheet and merges the live form rows on
top. This is what makes scan-read dates reach the Transport page. Called from the AI Coordinator (ai-coordinator/run.sh).

  python3 transport/export_fleet.py                 # push to the backend (needs ~/.lmcs/transport_push_secret)
  python3 transport/export_fleet.py --out x.json    # dry run to a local file, nothing sent

The secret is the value of TRANSPORT_PUSH_SECRET in the Coordinator Apps Script project's Script properties.
No employee codes or salaries are sent; the payload holds driver names and bus papers only.
"""
import argparse, difflib, json, re, sqlite3, subprocess, sys, time
from datetime import date, datetime, timezone
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
from build_master import XLSX, DB, DB_TYPES, norm, sheet
from reread_unread import SIDECAR, file_id

SECRET_FILE = Path.home() / ".lmcs" / "transport_push_secret"
COORDINATOR_GS = Path(__file__).parent.parent / "apps-script" / "coordinator.gs"  # holds COORD_ROSTER_URL, the public staff-roster endpoint
SHARED_JS = Path(__file__).parent.parent / "coordinator" / "shared.js"  # holds BACKEND_URL, the one place the backend URL lives
OVERRIDES = Path("/Users/udaykanwar/Library/CloudStorage/OneDrive-Personal/2. Areas/Uday Obsidian KMS/Uday's KMS/work/Transport Overrides.md")
DOC_NAMES = {"insurance": "insurance", "fitness": "fitness", "mvtax": "mv_tax", "roadtax": "mv_tax", "tax": "mv_tax",
             "pollution": "pollution", "puc": "pollution", "routepermit": "route_permit", "permit": "route_permit",
             "speedgovernor": "speed_governor", "governor": "speed_governor",
             "registration": "rc", "rc": "rc", "registrationcertificate": "rc", "registrationdate": "rc"}  # rc: Valid to = the date of registration
MIN_FLEET = 15  # fewer vehicles than this means the workbook read went wrong; never overwrite good data with it
LO, HI = date(2015, 1, 1), date(2040, 12, 31)  # a read date outside this is a misread, treated as unreadable


def apply_reread(out):
    """Fold the second-pass outcomes (reread_unread.py, drive-index/transport_reread.json) into the scan data. A scan that was
    unreadable becomes: a dated document (if a date was read), `noexpiry` (the right paper, no expiry printed), `other`
    (not the paper its folder says) or stays `unreadable` (illegible / not read yet)."""
    try:
        state = json.loads(SIDECAR.read_text())
    except (OSError, ValueError):
        return
    for e in out.values():
        keep = []
        for u in e["unreadable"]:
            r = state.get(file_id(u["link"]))
            o = r["outcome"] if r else ""
            if o == "date":
                cur = e["docs"].get(u["key"])
                if not cur or r["date"] > cur["date"]:
                    e["docs"][u["key"]] = {"date": r["date"], "file": u["file"], "link": u["link"], "src": "reread",
                                           "note": f'LM Studio re-read: "{r.get("quote", "")}"'}
            elif o == "no_expiry":
                e.setdefault("noexpiry", []).append({**u, "note": r.get("doc_type_seen", "")})
            elif o == "other_document":
                e.setdefault("other", []).append({**u, "note": r.get("doc_type_seen", "")})
            else:
                keep.append(u)
        e["unreadable"] = keep


def scans():
    """{reg: {'docs': {key: {date,file,link}}, 'unreadable': [{key,file,link}]}} from records.db (newest readable date per document)."""
    out = {}
    q = ("select entity, doc_type, relpath, drive_link, valid_to from documents "
         "where entity_type='bus' order by valid_to")
    for reg, t, rel, link, vt in sqlite3.connect(DB).execute(q):
        key = DB_TYPES.get(t)
        if not key or key == "rc":
            continue
        e = out.setdefault(reg, {"docs": {}, "unreadable": []})
        f = {"file": Path(rel).name, "link": link}
        try:
            d = date.fromisoformat(vt)
            ok = LO <= d <= HI
        except (TypeError, ValueError):
            ok = False
        if not ok:
            e["unreadable"].append({"key": key, **f})
        elif key not in e["docs"] or vt > e["docs"][key]["date"]:
            e["docs"][key] = {"date": vt, **f}
    apply_reread(out)
    return out


# ── The Vehicle papers quest, pre-filled from the scans: what LM Studio read off each RC / fitness / other bus paper ──
# records.db says which Drive file is which bus's which paper; the values are in that file's "Key data" in
# drive-index/descriptions/ (records.db keeps only the dates it normalised). Both stay outside the repo; nothing here holds a value.
DESCRIPTIONS = DB.parent / "descriptions"
PAPER_DOCS = {"rc": "RC", "fitness": "fitness", "pollution": "pollution", "insurance": "insurance", "mv_tax": "MV tax", "route_permit": "route permit"}
# the speed governor certificate is left out: its Make / Model are the governor's, not the bus's
IDENTITY = {"chassisNo", "engineNo", "make", "modelAndVariant", "fuel", "dateOfRegistration"}  # the RC beats every other paper for these
PAPER_KEYS = {  # Key data key (lower case, letters and digits only, a leading "(ii) " dropped) -> papers quest field id (mfgYear: shown only)
    "chassisNo": {"chassisno", "chassisnumber", "chassisnoofvehicle"},
    "engineNo": {"engineno", "enginenumber", "enginemotorno", "enginemotornumber", "enginenoofvehicle"},
    "make": {"make", "maker", "makersname", "makername"},
    "modelAndVariant": {"model", "modelname", "vehiclemodel", "vehiclemodelname", "modelvehiclevariant", "modelvehiclevariantsubtype", "modelcommercialnameofthevehicle"},
    "fuel": {"fuel", "fuelused", "fueltype", "typeoffuel"},
    "emissionNorm": {"emissionnorm", "emissionnorms", "applicableemissionnorms"},
    "seatingCapacityAsPerRc": {"seatingcapacity", "licensedseatingcapacity", "seatingcapacitypublicprivate", "seatinginallstandingsleepercapacity"},
    "dateOfRegistration": {"registrationdate", "dateofregistration", "dateofregn"},
    "mfgYear": {"manufacturingyear", "manufactureyear", "manufacturedyear", "monthyearofmfg", "mfgmonthyear", "yearofmfg", "yearofmanufacture",
                "monthyearofmanufacturing", "mfgyr"},
}
FIELD_OF = {k: f for f, keys in PAPER_KEYS.items() for k in keys}
JUNK = re.compile(r"not (available|mentioned|specified|visible|legible|clear)|unclear|illegible|^(n/?a|nil|none|unknown|-+)$", re.I)
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def norm_fuel(v):
    s = str(v or "").lower()
    for word, fuel in ((r"electric|battery|\bev\b|\bbov\b", "Electric"), (r"cng", "CNG"), (r"diesel", "Diesel"), (r"petrol", "Petrol")):
        if re.search(word, s):
            return fuel
    return None


def norm_emission(v):
    s = re.sub(r"[^A-Z0-9]", "", re.sub(r"B\w*RAT\s*STAGE", "BS", str(v or "").upper()))  # Bharat Stage, as misspelt on some papers too
    m = re.search(r"BS(III|IV|VI|3|4|6)", s)
    return "BS-" + {"3": "III", "4": "IV", "6": "VI"}.get(m[1], m[1]) if m else None


def norm_date(v):
    """yyyy-mm-dd from 2017-04-05, 05/04/2017 (day first), 05.04.2017 or 05-Apr-2017; None when it is not a real date."""
    s = str(v or "")
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = m[1], m[2], m[3]
    elif m := re.search(r"(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})", s):
        d, mo, y = m[1], m[2], m[3]
    elif (m := re.search(r"(\d{1,2})[-/ ,]*([A-Za-z]{3})[A-Za-z]*[-/ ,]*(\d{4})", s)) and m[2].lower() in MONTHS:
        d, mo, y = m[1], MONTHS[m[2].lower()], m[3]
    else:
        return None
    try:
        out = date(int(y), int(mo), int(d))
    except ValueError:
        return None
    return out.isoformat() if date(1980, 1, 1) <= out <= HI else None


def paper_value(field, raw):
    """The value as the quest form takes it, or None: fuel / emission / dates normalised, the rest as written."""
    v = re.sub(r"\s+", " ", str(raw or "")).strip().strip("*`\"'").strip()
    v = re.sub(r"^[=+\-@\s]+", "", v)  # never starts like a spreadsheet formula
    if not v or JUNK.search(v) or len(v) > 120:
        return None
    if field == "fuel":
        return norm_fuel(v)
    if field == "emissionNorm":
        return norm_emission(v)
    if field == "dateOfRegistration":
        return norm_date(v)
    if field == "mfgYear":
        m = re.search(r"(?<!\d)(19[89]\d|20[0-4]\d)(?!\d)", v)
        return m[1] if m else None
    return v


def same_paper_value(field, a, b):
    """Two scans agree: the same seats count (15 (including Driver) = 14+1); a chassis / engine no. that one paper prints masked
    (a run of X or *, as the tax receipt prints it) matches on what is shown; make and model agree when one contains the other or
    they start alike (a maker's short and full name, a model with and without its variant): only a real difference asks staff to
    check the paper."""
    if field == "seatingCapacityAsPerRc":
        n = lambda x: sum(map(int, re.findall(r"\d+", x))) or norm(x)
        return n(a) == n(b)
    if field in ("chassisNo", "engineNo"):
        a, b = (re.sub(r"[^a-z0-9*]", "", x.lower()) for x in (a, b))
        mask = lambda x: re.sub(r"[x*]{3,}", lambda m: "." * len(m[0]), x)  # a run of 3+ x or * hides that many characters
        if any(re.search(r"[x*]{3,}", x) and re.search(mask(x), y) for x, y in ((a, b), (b, a))):
            return True
    else:
        a, b = norm(a), norm(b)
    if a == b or (field in ("make", "modelAndVariant", "chassisNo", "engineNo") and a and b and (a in b or b in a)):
        return True
    return field in ("make", "modelAndVariant") and len(a) >= 4 and a[:4] == b[:4]


def papers_from(records):
    """records [{reg, key (rc / fitness / ...), when (yyyy-mm-dd, for newest), file, link, body (the scan's Key data text)}] ->
    {reg: {fieldId: {value, doc, file, link, disagree?}}}. The RC beats every other paper for the identity fields; otherwise the
    newest scan wins. Scans that disagree keep the winner and say disagree: True."""
    seen = {}  # (reg, field) -> [(is_rc, when, rec, value)]
    for r in records:
        if r["key"] not in PAPER_DOCS:
            continue
        got = set()
        for m in re.finditer(r"^\s*[-*]\s*([^:\n]{1,60}):[ \t]*(.+)$", r["body"], re.M):
            field = FIELD_OF.get(norm(re.sub(r"^\s*\([ivx]+\)\s*", "", m[1], flags=re.I)))
            if not field or field in got:
                continue  # one value per field per scan: the first line that says it
            v = paper_value(field, m[2])
            if v:
                got.add(field)
                seen.setdefault((r["reg"], field), []).append((r["key"] == "rc", r.get("when") or "", r, v))
    out = {}
    for (reg, field), c in seen.items():
        rank = (lambda x: (x[0], x[1])) if field in IDENTITY else (lambda x: x[1])
        win = max(c, key=rank)
        e = {"value": win[3], "doc": PAPER_DOCS[win[2]["key"]], "file": win[2]["file"], "link": win[2]["link"]}
        if any(not same_paper_value(field, x[3], win[3]) for x in c):
            e["disagree"] = True
        out.setdefault(reg, {})[field] = e
    return out


def paper_records():
    """Every bus scan of a paper that can carry the papers quest's values, with its Key data text (read only; nothing is copied)."""
    bodies = {}
    for md in DESCRIPTIONS.rglob("*.md"):
        for m in re.finditer(r"^## (.+)\n((?:(?!## ).*\n?)*)", md.read_text(), re.M):
            bodies[m[1].strip()] = m[2]
    q = "select entity, doc_type, relpath, drive_link, issue_date, valid_from, valid_to from documents where entity_type='bus'"
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    return [{"reg": reg, "key": DB_TYPES.get(t) or t, "when": max(norm_date(x) or "" for x in (iss, vf, vt)), "file": Path(rel).name,
             "link": link or "", "body": bodies.get(rel, "")} for reg, t, rel, link, iss, vf, vt in db.execute(q)]


def paper_overrides(papers, ov):
    """A registration date typed into the vault's Transport Overrides note (Document "Registration" or "RC") beats every scan."""
    for (reg, key), o in ov.items():
        if key == "rc" and o.get("date"):
            papers.setdefault(reg, {})["dateOfRegistration"] = {"value": o["date"], "doc": "overrides", "file": "Transport overrides note", "link": ""}


def seen_ids():
    """Every bus scan file id in records.db, whatever LM Studio made of it: a portal upload whose id is here has been read."""
    q = "select drive_link from documents where entity_type='bus'"
    return sorted({m[1] for (link,) in sqlite3.connect(DB).execute(q) if (m := re.search(r"/d/([-\w]{20,})", link or ""))})


def push(body):
    """POST the payload to the Coordinator backend; exits non-zero (so the AI Coordinator logs it) on any failure."""
    if not SECRET_FILE.exists():
        sys.exit(f"{SECRET_FILE} not found; create it with the TRANSPORT_PUSH_SECRET value, or use --out for a dry run")
    url = re.search(r"BACKEND_URL = '([^']+)'", SHARED_JS.read_text())[1]
    payload = json.dumps({"action": "transportpush", "secret": SECRET_FILE.read_text().strip(), "payload": json.loads(body)})
    # curl, not urllib: this Python has no CA certs; -L because Apps Script answers a POST with a redirect to the result
    r = subprocess.run(["curl", "-sSL", "-m", "120", "-H", "Content-Type: text/plain", "--data-binary", "@-", url],
                       input=payload, capture_output=True, text=True)
    try:
        res = json.loads(r.stdout)
    except ValueError:
        sys.exit(f"backend did not return JSON (curl exit {r.returncode}): {r.stdout[:200]!r} {r.stderr[:200]}")
    if not res.get("success"):
        sys.exit(f"backend refused the push: {res.get('error')}")
    return f"backend ({res['vehicles']} vehicles, {res['documents']} document rows stored)"


def pnl(wb, mapping):
    """Per bus per month money from the workbook's Transport Monthly tab: fee, fuel, loan interest, fixed costs (insurance, taxes,
    service, parking, challan), plus the monthly driver (and helper) pay. Matches the workbook's own Bus P&L tab to the rupee.
    Pay comes from Transport Mapping; where that cell is an error (#N/A) it falls back to the driver's CTI in Man Power Info and
    the row is noted, so a bus is never shown as costing nothing just because a lookup failed."""
    people = sheet(wb, "Man Power Info.")
    def pay(reg, campus):
        m = mapping.get(reg, {})
        v = m.get("Overall Sal Expense")
        if isinstance(v, (int, float)):
            return v, ""
        name = norm(m.get("Driver Name"))
        pool = {norm(p["Name"]): p for p in people if p["School"] == campus}
        hit = difflib.get_close_matches(name, pool, n=1, cutoff=0.8) if name else []
        if hit:
            return pool[hit[0]]["CTI"] or 0, "driver pay from Man Power Info (the Transport Mapping cell is an error)"
        return 0, "no driver pay recorded" if not m else "no driver pay found"
    rows, notes, monthly = [], {}, {}
    for r in sheet(wb, "Transport Monthly"):
        reg = norm(r["Bus No."]).upper()
        if not reg or not r["Start Date"]:
            continue
        campus = str(r["School"] or "")
        if reg not in monthly:
            monthly[reg], notes[reg] = pay(reg, campus)
        num = lambda k: r[k] if isinstance(r[k], (int, float)) else 0
        rows.append({"reg": reg, "campus": campus, "month": str(r["Start Date"])[:7], "fee": num("Fee Collected"), "fuel": num("Fuel Expense"),
                     "loan": num("Loan Interest"), "fixed": num("Total Fix Expense"), "pay": monthly[reg], "note": notes[reg]})
    return rows


ROSTER_CACHE = Path(__file__).parent.parent / "drive-index" / "staff_roster_cache.json"  # last good copy of the roster
ROSTER_TRIES, ROSTER_WAIT, ROSTER_CACHE_DAYS = 3, 4, 7


def staff_roster():
    """{normalised employee code: {employeeCode, name, school}} of active staff, from the public Employee Roster Proxy (the staff master).
    The proxy sometimes answers with an error page, so it is tried ROSTER_TRIES times; if it still fails, the last good copy (saved on every
    success, at most ROSTER_CACHE_DAYS old) is used, so one bad reply never turns 28 verified people into "not checked" for 2 hours.
    Returns None only when there is neither a fresh answer nor a recent copy."""
    url = re.search(r"COORD_ROSTER_URL = '([^']+)'", COORDINATOR_GS.read_text())[1]
    emps = None
    for n in range(ROSTER_TRIES):
        r = subprocess.run(["curl", "-sSL", "-m", "90", url + "?action=employees"], capture_output=True, text=True)
        try:
            d = json.loads(r.stdout)
            if d.get("success") and d.get("employees"):
                emps = d["employees"]
                break
        except ValueError:
            pass
        if n < ROSTER_TRIES - 1:
            time.sleep(ROSTER_WAIT)
    if emps:
        ROSTER_CACHE.write_text(json.dumps({"savedAt": time.time(), "employees": emps}))
    else:
        try:
            c = json.loads(ROSTER_CACHE.read_text())
            if time.time() - c["savedAt"] < ROSTER_CACHE_DAYS * 86400:
                emps = c["employees"]
                print("staff roster unreachable; using the copy saved " + datetime.fromtimestamp(c["savedAt"]).strftime("%d %b %H:%M"), file=sys.stderr)
        except (OSError, ValueError, KeyError):
            pass
    return {norm(e["employeeCode"]): e for e in emps} if emps else None


def link_staff(wb, mapping, fleet):
    """Link every person on the transport Man Power sheet, and every bus driver, to the staff master by employee code.
    Status per person: verified | campus differs | name differs | code not in staff master | no employee code | not checked.
    Adds driverCode / driverStatus / driverRosterName to each vehicle. Returns the people list (no pay figures)."""
    roster = staff_roster()
    people = []
    for r in sheet(wb, "Man Power Info."):
        code = str(r["Employee Code"] or "").strip()
        e = roster.get(norm(code)) if roster and code else None
        if roster is None:
            status = "not checked"
        elif not code:
            status = "no employee code"
        elif not e:
            status = "code not in staff master"
        elif norm(e["school"]) != norm(r["School"]):
            status = "campus differs"
        elif difflib.SequenceMatcher(None, norm(r["Name"]), norm(e["name"])).ratio() < 0.6:
            status = "name differs"
        else:
            status = "verified"
        people.append({"name": str(r["Name"]).strip(), "campus": str(r["School"]).strip(), "designation": r["Designation"] or "", "code": code,
                       "status": status, "rosterName": e["name"].strip() if e else "", "rosterCampus": e["school"].strip() if e else "", "vehicles": []})
    for v in fleet:
        name = norm(mapping.get(v["reg"], {}).get("Driver Name"))
        pool = {norm(p["name"]): p for p in people if norm(p["campus"]) == norm(v["campus"])}
        hit = name if name in pool else next(iter(difflib.get_close_matches(name, pool, n=1, cutoff=0.8)), "") if name else ""
        p = pool.get(hit)
        v["driverCode"], v["driverStatus"], v["driverRosterName"] = (p["code"], p["status"], p["rosterName"]) if p else ("", "", "")
        if p:
            p["vehicles"].append(v["reg"])
    return people


def overrides(known):
    """Hand-entered dates from the vault note: a markdown table (Vehicle | Document | Valid to | Note), lines in code fences ignored.
    Valid to is YYYY-MM-DD, DD/MM/YYYY (day first) or n/a (this vehicle does not need that paper).
    Returns ({(reg, key): {date|na, note}}, [warning]); a bad row is skipped with a warning, never guessed."""
    out, warn, fence = {}, [], False
    if not OVERRIDES.exists():
        return out, ["overrides note not found, none applied"]
    for n, line in enumerate(OVERRIDES.read_text().splitlines(), 1):
        if line.strip().startswith("```"):
            fence = not fence
            continue
        if fence or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or set("".join(cells[:3])) <= set("-: ") or cells[0].lower() == "vehicle":
            continue
        reg, key, val = norm(cells[0]).upper(), DOC_NAMES.get(norm(cells[1])), cells[2].lower().replace(" ", "")
        note = cells[3] if len(cells) > 3 else ""
        if not reg and not key and not val:
            continue  # an empty template row
        if reg not in known:
            warn.append(f"line {n}: vehicle '{cells[0]}' is not in the fleet"); continue
        if not key:
            warn.append(f"line {n}: unknown document '{cells[1]}'"); continue
        if val in ("n/a", "na"):
            out[(reg, key)] = {"na": True, "note": note}; continue
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", val)
        try:
            d = date(int(m[1]), int(m[2]), int(m[3])) if m[1] else date(int(m[6]), int(m[5]), int(m[4]))
            assert (date(1980, 1, 1) if key == "rc" else LO) <= d <= HI  # a bus can be registered before 2015
        except (TypeError, ValueError, AssertionError):
            warn.append(f"line {n}: '{cells[2]}' is not a usable date (use YYYY-MM-DD or DD/MM/YYYY)"); continue
        out[(reg, key)] = {"date": d.isoformat(), "note": note}
    return out, warn


def selftest():
    """The roster fallback, with the network and the clock faked. No files outside a temp folder are touched."""
    import tempfile
    global ROSTER_CACHE, ROSTER_WAIT
    ROSTER_CACHE, ROSTER_WAIT = Path(tempfile.mkdtemp()) / "cache.json", 0
    good = json.dumps({"success": True, "employees": [{"employeeCode": "KUL/1", "name": "A", "school": "LMS 1"}]})
    bad = "<html>Sorry, unable to open the file at this time.</html>"
    replies, real = [], subprocess.run
    subprocess.run = lambda *a, **k: type("R", (), {"stdout": replies.pop(0), "returncode": 0})()
    try:
        replies[:] = [bad, bad, good]
        assert staff_roster() is not None, "should succeed on the third try"
        replies[:] = [bad, bad, bad]
        assert "kul1" in staff_roster(), "should fall back to the last good copy"
        ROSTER_CACHE.write_text(json.dumps({"savedAt": time.time() - 9 * 86400, "employees": []}))
        replies[:] = [bad, bad, bad]
        assert staff_roster() is None, "a copy older than 7 days must not be trusted"
        ROSTER_CACHE.unlink()
        replies[:] = [bad, bad, bad]
        assert staff_roster() is None, "no answer and no copy means unknown, not verified"
    finally:
        subprocess.run = real
    print("export_fleet selftest: 4 checks passed")
    selftest_papers()


def selftest_papers():
    """The papers builder on SYNTHETIC scans (fake regs and numbers, never real paper values: the repo is public)."""
    import tempfile
    global OVERRIDES
    n = 0
    def ok(cond, msg):
        nonlocal n
        assert cond, msg
        n += 1
    kd = lambda **kv: "Drive link: https://drive.google.com/file/d/x/view\nKey data:\n" + "\n".join(f"- {k}: {v}" for k, v in kv.items()) + "\n\nSummary:\nA test scan."
    rec = lambda reg, key, when, **kv: {"reg": reg, "key": key, "when": when, "file": key + ".jpg", "link": "L-" + reg + "-" + key, "body": kd(**kv)}
    recs = [
        rec("TEST01", "fitness", "2025-06-01", **{"Chassis No": "TESTCHASSIS0001", "Engine No.": "TESTENGINE01", "Seating Capacity": "15 (including Driver)",
                                                 "Manufacturing Year": "03/2017"}),
        rec("TEST01", "rc", "2017-04-01", **{"Chassis Number": "TESTCHASSIS0009", "Engine Number": "TESTENGINE01", "Maker's Name": "TESTMAKER",
                                            "Model": "TESTMODEL 1512", "Fuel Used": "DIESEL", "Emission Norms": "BHARAT STAGE IV",
                                            "Registration Date": "05-Apr-2017", "Seating Capacity": "14+1"}),
        rec("TEST01", "pollution", "2026-01-01", **{"Fuel": "Diesel", "Emission Norms": "BS-VI"}),
        rec("TEST02", "insurance", "2026-02-01", **{"Fuel Type": "Petrol/CNG", "Date of Regn.": "12/03/2016", "Year of Mfg": "2015",
                                                    "Engine No.": "Not Available", "(ii) Seating Capacity": "=40"}),
        rec("TEST02", "speed_governor", "2026-03-01", **{"Make": "GOVERNORCO", "Model Name": "SG-1"}),
    ]
    p = papers_from(recs)
    a = p["TEST01"]
    ok(a["chassisNo"]["value"] == "TESTCHASSIS0009" and a["chassisNo"]["doc"] == "RC", "the RC beats a newer fitness scan for the chassis no.")
    ok(a["chassisNo"]["disagree"] is True, "two scans with different chassis numbers are flagged")
    ok(a["chassisNo"]["link"] == "L-TEST01-rc" and a["chassisNo"]["file"] == "rc.jpg", "the winner's file and link travel with the value")
    ok(a["engineNo"]["value"] == "TESTENGINE01" and not a["engineNo"].get("disagree"), "agreeing scans are not flagged")
    ok(a["make"]["value"] == "TESTMAKER" and a["modelAndVariant"]["value"] == "TESTMODEL 1512", "make and model as written")
    ok(a["fuel"] == {"value": "Diesel", "doc": "RC", "file": "rc.jpg", "link": "L-TEST01-rc"}, "fuel normalised, the RC wins, Diesel = Diesel")
    ok(a["dateOfRegistration"]["value"] == "2017-04-05", "a 05-Apr-2017 date becomes yyyy-mm-dd")
    ok(a["seatingCapacityAsPerRc"]["value"] == "15 (including Driver)" and a["seatingCapacityAsPerRc"]["doc"] == "fitness", "seats: the newest scan wins, as written")
    ok(not a["seatingCapacityAsPerRc"].get("disagree"), "15 (including Driver) and 14+1 are the same 15 seats")
    ok(a["emissionNorm"]["value"] == "BS-VI" and a["emissionNorm"]["doc"] == "pollution", "emission norm: the newest scan wins (not an identity field)")
    ok(a["emissionNorm"]["disagree"] is True, "BS-VI against the RC's BHARAT STAGE IV is a disagreement")
    ok(a["mfgYear"]["value"] == "2017" and a["mfgYear"]["doc"] == "fitness", "year of manufacture read out of 03/2017")
    b = p["TEST02"]
    ok(b["fuel"]["value"] == "CNG" and b["fuel"]["doc"] == "insurance", "Petrol/CNG is a CNG bus; no RC: the other paper is used")
    ok(b["dateOfRegistration"]["value"] == "2016-03-12", "12/03/2016 is day first")
    ok(b["mfgYear"]["value"] == "2015", "year of mfg")
    ok("engineNo" not in b, "a 'Not Available' value is dropped")
    ok(b["seatingCapacityAsPerRc"]["value"] == "40", "a value never starts like a spreadsheet formula")
    ok("make" not in b and "modelAndVariant" not in b, "the speed governor certificate's make and model are the governor's, not the bus's")
    ok(same_paper_value("chassisNo", "XXXXXXXXXXX00009", "TESTCHASSIS00009") and same_paper_value("chassisNo", "TESTC*****S00009", "TESTCHASSIS00009") and not same_paper_value("chassisNo", "TESTCHASSIS00008", "TESTCHASSIS00009"),
       "a masked chassis no. matches on what it shows; one wrong character is a disagreement")
    ok(same_paper_value("make", "TESTMAKER MOTORS LTD", "TESTMAKER") and same_paper_value("modelAndVariant", "TESTMODEL ULTRA", "TESTMODEL 1512")
       and not same_paper_value("make", "TESTMAKER", "OTHERMAKER"), "make and model: contains or starts alike")
    ok(norm_fuel("ELECTRIC (BOV)") == "Electric" and norm_fuel("water") is None, "fuel: one of Diesel/CNG/Petrol/Electric or nothing")
    ok([norm_emission(x) for x in ("BSIII", "Bharat Stage-6", "BAHARAT STAGE IV", "BS 4", "BS-II", "EURO 1", "")] == ["BS-III", "BS-VI", "BS-IV", "BS-IV", None, None, None], "emission: BS-III/IV/VI or nothing")
    ok([norm_date(x) for x in ("2017-4-5", "5.4.2017", "05 APRIL 2017", "31/02/2017", "soon")] == ["2017-04-05", "2017-04-05", "2017-04-05", None, None], "dates: yyyy-mm-dd or nothing")
    # the overrides note: a registration row (Document "Registration" or "RC") wins over every scan
    OVERRIDES = Path(tempfile.mkdtemp()) / "overrides.md"
    OVERRIDES.write_text("| Vehicle | Document | Valid to | Note |\n|---|---|---|---|\n| TEST01 | Registration | 02/01/2012 | typed off the RC |\n"
                         "| TEST02 | RC | 2016-03-15 | |\n")
    ov, warn = overrides({"TEST01", "TEST02"})
    ok(ov.get(("TEST01", "rc"), {}).get("date") == "2012-01-02" and not warn, "a registration row parses, a date before 2015 included")
    paper_overrides(p, ov)
    ok(p["TEST01"]["dateOfRegistration"] == {"value": "2012-01-02", "doc": "overrides", "file": "Transport overrides note", "link": ""}, "the override beats the RC scan")
    ok(p["TEST02"]["dateOfRegistration"]["value"] == "2016-03-15", "and the insurance scan")
    print(f"export_fleet papers selftest: {n} checks passed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--synced-at", help="UTC start of the sync that produced the scan data (default: now); files created after it show as waiting to be read")
    ap.add_argument("--xlsx", default=XLSX)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.synced_at:
        datetime.strptime(a.synced_at, "%Y-%m-%dT%H:%M:%SZ")  # the backend compares it as text in a Drive query; fail loudly on a malformed value
    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    mapping = {norm(r["Reg. No."]).upper(): r for r in sheet(wb, "Transport Mapping")}
    s = scans()
    fleet = []
    for r in sheet(wb, "Transport Info. "):
        campus = str(r["Column1"] or "")
        if not campus.upper().startswith("LMS"):
            continue  # private cars and sold bikes sit below the school vehicles
        reg = norm(r["Reg. No."]).upper()
        m = mapping.get(reg, {})
        fleet.append({"reg": reg, "bus": r["Bus No."], "campus": campus, "seats": r["Seating Capacity"],
                      "year": r["Year of Purchase"], "operational": "not op" not in str(r["Status"] or "").lower(),
                      "route": m.get("Route") or "", "start": m.get("Start Point") or "", "driver": str(m.get("Driver Name") or "").strip(),
                      "docs": s.get(reg, {}).get("docs", {}), "unreadable": s.get(reg, {}).get("unreadable", []),
                      "noexpiry": s.get(reg, {}).get("noexpiry", []), "other": s.get(reg, {}).get("other", [])})
    people = link_staff(wb, mapping, fleet)
    ov, warnings = overrides({v["reg"] for v in fleet})
    papers = papers_from(paper_records())
    paper_overrides(papers, ov)
    for v in fleet:
        v["papers"] = papers.get(v["reg"], {})
        for (reg, key), o in ov.items():
            if reg != v["reg"] or key == "rc":  # a registration date goes to the papers, not the dated documents
                continue
            v["docs"][key] = {"date": o.get("date", ""), "na": o.get("na", False), "src": "override", "note": o["note"],
                              "file": "Transport overrides note", "link": ""}
            for k in ("unreadable", "noexpiry", "other"):  # a person has settled that paper
                v[k] = [u for u in v[k] if u["key"] != key]
    if len(fleet) < MIN_FLEET:
        sys.exit(f"only {len(fleet)} vehicles read from {a.xlsx}; not writing")
    body = json.dumps({"syncedAt": a.synced_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "source": "transport workbook + drive-index/records.db and descriptions + vault overrides note", "warnings": warnings, "pnl": pnl(wb, mapping), "people": people, "seen": seen_ids(), "fleet": fleet}, separators=(",", ":"))
    if a.out:
        Path(a.out).write_text(body)
        dest = a.out
    else:
        dest = push(body)
    print(f"{len(fleet)} vehicles, {sum(len(v['docs']) for v in fleet)} dated documents, "
          f"{sum(len(v['unreadable']) for v in fleet)} unreadable scans, {len(ov)} overrides, "
          f"{sum(p['status'] == 'verified' for p in people)}/{len(people)} staff verified, "
          f"{sum(len(v['papers']) for v in fleet)} papers values -> {dest}")
    for w in warnings:
        print("override warning:", w)


if __name__ == "__main__":
    main()
