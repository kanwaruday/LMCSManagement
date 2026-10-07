#!/usr/bin/env python3
"""Push the fleet roster (from the transport workbook on OneDrive) plus the document dates LM Studio read
from the Drive scans (drive-index/records.db) and the vault overrides note to the Coordinator backend, which
keeps them in the "LM Studio ..." tabs of the transport form-responses sheet and merges the live form rows on
top. This is what makes scan-read dates reach the Transport page. Called at the end of drive-index/sync.sh.

  python3 transport/export_fleet.py                 # push to the backend (needs ~/.lmcs/transport_push_secret)
  python3 transport/export_fleet.py --out x.json    # dry run to a local file, nothing sent

The secret is the value of TRANSPORT_PUSH_SECRET in the Coordinator Apps Script project's Script properties.
No employee codes or salaries are sent; the payload holds driver names and bus papers only.
"""
import argparse, difflib, json, re, sqlite3, subprocess, sys
from datetime import date, datetime, timezone
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
from build_master import XLSX, DB, DB_TYPES, norm, sheet

SECRET_FILE = Path.home() / ".lmcs" / "transport_push_secret"
COORDINATOR_GS = Path(__file__).parent.parent / "apps-script" / "coordinator.gs"  # holds COORD_ROSTER_URL, the public staff-roster endpoint
SHARED_JS = Path(__file__).parent.parent / "coordinator" / "shared.js"  # holds BACKEND_URL, the one place the backend URL lives
OVERRIDES = Path("/Users/udaykanwar/Library/CloudStorage/OneDrive-Personal/2. Areas/Uday Obsidian KMS/Uday's KMS/work/Transport Overrides.md")
DOC_NAMES = {"insurance": "insurance", "fitness": "fitness", "mvtax": "mv_tax", "roadtax": "mv_tax", "tax": "mv_tax",
             "pollution": "pollution", "puc": "pollution", "routepermit": "route_permit", "permit": "route_permit",
             "speedgovernor": "speed_governor", "governor": "speed_governor"}
MIN_FLEET = 15  # fewer vehicles than this means the workbook read went wrong; never overwrite good data with it
LO, HI = date(2015, 1, 1), date(2040, 12, 31)  # a read date outside this is a misread, treated as unreadable


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
    return out


def push(body):
    """POST the payload to the Coordinator backend; exits non-zero (so sync.sh logs it) on any failure."""
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


def staff_roster():
    """{normalised employee code: {employeeCode, name, school}} of active staff, from the public Employee Roster Proxy (the staff master).
    Returns None if it cannot be read; the caller then marks everyone 'not checked' instead of failing the push."""
    url = re.search(r"COORD_ROSTER_URL = '([^']+)'", COORDINATOR_GS.read_text())[1]
    r = subprocess.run(["curl", "-sSL", "-m", "90", url + "?action=employees"], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        return {norm(e["employeeCode"]): e for e in d["employees"]} if d.get("success") else None
    except (ValueError, KeyError):
        return None


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
            assert LO <= d <= HI
        except (TypeError, ValueError, AssertionError):
            warn.append(f"line {n}: '{cells[2]}' is not a usable date (use YYYY-MM-DD or DD/MM/YYYY)"); continue
        out[(reg, key)] = {"date": d.isoformat(), "note": note}
    return out, warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--synced-at", help="UTC start of the sync that produced the scan data (default: now); files created after it show as waiting to be read")
    ap.add_argument("--xlsx", default=XLSX)
    a = ap.parse_args()
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
                      "docs": s.get(reg, {}).get("docs", {}), "unreadable": s.get(reg, {}).get("unreadable", [])})
    people = link_staff(wb, mapping, fleet)
    ov, warnings = overrides({v["reg"] for v in fleet})
    for v in fleet:
        for (reg, key), o in ov.items():
            if reg != v["reg"]:
                continue
            v["docs"][key] = {"date": o.get("date", ""), "na": o.get("na", False), "src": "override", "note": o["note"],
                              "file": "Transport overrides note", "link": ""}
            v["unreadable"] = [u for u in v["unreadable"] if u["key"] != key]  # a person has settled that paper
    if len(fleet) < MIN_FLEET:
        sys.exit(f"only {len(fleet)} vehicles read from {a.xlsx}; not writing")
    body = json.dumps({"syncedAt": a.synced_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "source": "transport workbook + drive-index/records.db + vault overrides note", "warnings": warnings, "pnl": pnl(wb, mapping), "people": people, "fleet": fleet}, separators=(",", ":"))
    if a.out:
        Path(a.out).write_text(body)
        dest = a.out
    else:
        dest = push(body)
    print(f"{len(fleet)} vehicles, {sum(len(v['docs']) for v in fleet)} dated documents, "
          f"{sum(len(v['unreadable']) for v in fleet)} unreadable scans, {len(ov)} overrides, "
          f"{sum(p['status'] == 'verified' for p in people)}/{len(people)} staff verified -> {dest}")
    for w in warnings:
        print("override warning:", w)


if __name__ == "__main__":
    main()
