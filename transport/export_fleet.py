#!/usr/bin/env python3
"""Write LMCS_Transport_Fleet.json: the fleet roster (from the transport workbook on OneDrive) plus the
document dates LM Studio read from the Drive scans (drive-index/records.db). The Coordinator backend reads
it from Google Drive by name and merges the live submission-form rows on top, so this is what makes
scan-read dates reach the Transport page. Called at the end of drive-index/sync.sh; safe to run by hand.

  python3 transport/export_fleet.py                 # write to Google Drive (My Drive root)
  python3 transport/export_fleet.py --out x.json    # dry run to a local file

No employee codes or salaries go in the file; it holds driver names and bus papers only.
"""
import argparse, json, re, sqlite3, sys
from datetime import date, datetime, timezone
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
from build_master import XLSX, DB, DB_TYPES, norm, sheet

DRIVE = Path("/Users/udaykanwar/Library/CloudStorage/GoogleDrive-uday.kanwar@lms.org.in/My Drive")
TARGET = DRIVE / "LMCS_Transport_Fleet.json"  # root, outside "SCHOOL RELATED/LMS Central Repository" so the summariser never ingests it
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
                       "source": "transport workbook + drive-index/records.db + vault overrides note", "warnings": warnings, "fleet": fleet}, separators=(",", ":"))
    if a.out:
        Path(a.out).write_text(body)
        dest = a.out
    else:
        if not DRIVE.is_dir():
            sys.exit("Google Drive is not mounted; not writing")
        TARGET.write_text(body)
        dest = TARGET
    print(f"{len(fleet)} vehicles, {sum(len(v['docs']) for v in fleet)} dated documents, "
          f"{sum(len(v['unreadable']) for v in fleet)} unreadable scans, {len(ov)} overrides -> {dest}")
    for w in warnings:
        print("override warning:", w)


if __name__ == "__main__":
    main()
