#!/usr/bin/env python3
"""Build transport/master_bus_table.csv: one row per school vehicle, joining
the V3 Transport Management System workbook, the Transport Document Submission
form responses and drive-index/records.db. Re-run to refresh; nothing is cached.

  python3 transport/build_master.py [--xlsx PATH] [--today YYYY-MM-DD]
"""
import argparse, csv, difflib, io, re, sqlite3, subprocess
from datetime import date, datetime
from pathlib import Path
import openpyxl

HERE = Path(__file__).parent
XLSX = ("/Users/udaykanwar/Library/CloudStorage/OneDrive-Personal/1. Projects/"
        "Uday's Detailed Financial Analysis/V3 Transport Management System 2026 LMCS New.xlsx")
FORM = ("https://docs.google.com/spreadsheets/d/1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc"
        "/export?format=csv&gid=1365845375")
DB = HERE.parent / "drive-index" / "records.db"
DUE_DAYS = 30
# doc types that decide "can it run"; passenger tax / RC are left out on purpose
# (passenger tax stuck at 2020 for every bus, RC rarely has an expiry).
CORE = ["insurance", "fitness", "mv_tax", "pollution", "route_permit", "speed_governor"]
FORM_TYPES = {"FITNESS": "fitness", "ROUTE PERMIT": "route_permit", "RC": "rc", "INSURANCE": "insurance",
              "MV TAX": "mv_tax", "POLLUTION": "pollution", "SPEED GOVERNOR": "speed_governor"}
DB_TYPES = {"fitness_certificate": "fitness", "route_permit": "route_permit", "registration_certificate": "rc",
            "insurance": "insurance", "road_tax": "mv_tax", "pollution_certificate": "pollution",
            "speed_governor_certificate": "speed_governor"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def swapped(a, b):  # same date with day/month transposed (6 Jan vs 1 Jun)
    return a != b and a.year == b.year and a.month == b.day and a.day == b.month


def load_docs(today):
    """{reg: {doctype: (date, source)}}, newest expiry across form + DB, plus swap flags."""
    docs, flags = {}, []
    form = {}
    rows = csv.DictReader(io.StringIO(subprocess.check_output(['curl', '-sfL', FORM], text=True)))  # curl: python lacks CA certs here
    for r in rows:
        t = FORM_TYPES.get(r["Document Type"].strip().upper())
        if not t or not r["VALID TILL"].strip():
            continue
        d = datetime.strptime(r["VALID TILL"].strip(), "%m/%d/%Y").date()
        reg = norm(r["Transport Registration Number"]).upper()
        cur = form.get((reg, t))
        if not cur or d > cur:
            form[(reg, t)] = d
    dbv = {}
    for reg, t, vt in sqlite3.connect(DB).execute(
            "select entity, doc_type, valid_to from documents where entity_type='bus' and valid_to != ''"):
        t = DB_TYPES.get(t)
        if not t:
            continue
        d = date.fromisoformat(vt)
        if (reg, t) not in dbv or d > dbv[(reg, t)]:
            dbv[(reg, t)] = d
    for k in set(form) | set(dbv):
        f, d = form.get(k), dbv.get(k)
        if f and d and swapped(f, d):
            flags.append(f"{k[0]} {k[1]}: form says {f}, Drive says {d} (day/month swapped?)")
        best = max((x for x in ((f, "form"), (d, "drive")) if x[0]), key=lambda x: x[0])
        docs.setdefault(k[0], {})[k[1]] = best
    return docs, flags


def doc_state(entry, today):
    if not entry:
        return "missing"
    d = entry[0]
    return "expired" if d < today else "due" if (d - today).days <= DUE_DAYS else "ok"


def sheet(wb, name):
    rows = [r for r in wb[name].iter_rows(values_only=True)]
    hdr = [str(h).strip() if h else f"c{i}" for i, h in enumerate(rows[0])]
    return [dict(zip(hdr, r)) for r in rows[1:] if any(c is not None for c in r)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=XLSX)
    ap.add_argument("--today", default=str(date.today()))
    a = ap.parse_args()
    today = date.fromisoformat(a.today)
    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    docs, flags = load_docs(today)

    info = {norm(r["Reg. No."]).upper(): r for r in sheet(wb, "Transport Info. ")}
    mapping = {norm(r["Reg. No."]).upper(): r for r in sheet(wb, "Transport Mapping")}
    pnl = {norm(r["Reg. No."]).upper(): r for r in
           [dict(zip([c.value for c in wb["Bus P&L"][5]], [c.value for c in row]))
            for row in wb["Bus P&L"].iter_rows(min_row=6, max_row=wb["Bus P&L"].max_row - 1)] if r["Reg. No."]}
    people = sheet(wb, "Man Power Info.")
    students = {}
    for r in sheet(wb, "Student Data"):
        if r["Student Name"]:
            students[r["Route No."]] = students.get(r["Route No."], 0) + 1

    out = []  # cars/bikes (blank or "sold" in the campus column) are not school vehicles
    fleet = [(k, v) for k, v in info.items() if str(v["Column1"] or "").upper().startswith("LMS")]
    for reg, v in fleet:
        m = mapping.get(reg, {})
        school = m.get("School") or v["Column1"]
        drv = m.get("Driver Name") or ""
        emp = next((p for p in people if p["School"] == school and norm(p["Name"]) == norm(drv)), None)
        if not emp and drv:  # spelling drift e.g. Pushp/Pushap, Chandersen/Chander Sen
            names = {norm(p["Name"]): p for p in people if p["School"] == school}
            c = difflib.get_close_matches(norm(drv), names, n=1, cutoff=0.8)
            emp = names[c[0]] if c else None
        operational = "not op" not in str(v["Status"] or "").lower()
        states = {t: doc_state(docs.get(reg, {}).get(t), today) for t in CORE}
        worst = next((x for x in ("expired", "missing", "due") if x in states.values()), "ok")
        issues = "; ".join(f"{t} {st}" for t, st in states.items() if st != "ok")
        route = m.get("Route") or ""
        p = pnl.get(reg, {})
        row = {
            "reg_no": reg, "bus_no": v["Bus No."], "campus": school,
            "operational": "yes" if operational else "no", "year": v["Year of Purchase"],
            "seats": v["Seating Capacity"], "route": route, "start_point": m.get("Start Point") or "",
            "rounds": m.get("No. of Rounds") or "", "students_mapped_sheet": m.get("No. of Students") or "",
            "students_on_route": students.get(route, "") if route else "",
            "driver": drv, "driver_emp_code": emp["Employee Code"] if emp else "",
            "driver_cti": emp["CTI"] if emp else "", "helper": m.get("Helper") or "",
            "fee_6m": p.get("Fee Collected", ""), "net_pl_6m": p.get("Net P/L", ""),
            "compliance": worst if operational else "n/a (not operational)",
            "issues": issues if operational else "",
        }
        for t in CORE:
            e = docs.get(reg, {}).get(t)
            row[f"{t}_valid_to"] = e[0].isoformat() if e else ""
            row[f"{t}_src"] = e[1] if e else ""
        out.append(row)
        # cross-sheet conflicts worth a human look
        if not operational and route:
            flags.append(f"{reg}: 'not operational' in Transport Info but still mapped to {route} "
                         f"({students.get(route, 0)} students)")
        if route and m.get("No. of Students") and students.get(route) is not None \
                and abs(students[route] - m["No. of Students"]) > 5:
            flags.append(f"{reg} {route}: mapping says {m['No. of Students']} students, Student Data has {students[route]}")
        if operational and drv and not emp:
            flags.append(f"{reg}: driver '{drv}' not found in Man Power Info")
        if operational and drv and emp and str(m.get("Driver Salary")).startswith("#"):
            flags.append(f"{reg}: Mapping driver salary is #N/A (Man Power CTI is {emp['CTI']})")
        if not m:
            flags.append(f"{reg}: no row in Transport Mapping (no route/driver)")
    engines = {}
    for reg, v in info.items():
        engines.setdefault(norm(v["Engine No."]), []).append(reg)
    flags += [f"duplicate engine number across {', '.join(r)}" for e, r in engines.items() if e and len(r) > 1]

    path = HERE / "master_bus_table.csv"
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, out[0].keys())
        w.writeheader(); w.writerows(out)
    (HERE / "master_flags.txt").write_text("\n".join(sorted(flags)) + "\n")
    print(f"{len(out)} vehicles -> {path}\n{len(flags)} flags -> {HERE / 'master_flags.txt'}")


if __name__ == "__main__":
    main()
