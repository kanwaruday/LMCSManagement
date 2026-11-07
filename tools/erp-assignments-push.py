#!/usr/bin/env python3
"""Seed each private "LMSn ERP" Sheet's `assignments` tab from the timetables (Uday, 7 Nov via V1: "filled, so he only checks it").

  python3 tools/erp-assignments-push.py            dry run: per-campus counts only
  python3 tools/erp-assignments-push.py --go       push (POST erppush, replace); refused if a tab already holds rows
  python3 tools/erp-assignments-push.py --go --overwrite   replace a filled tab (wipes Principals' fixes)
  --whole-class   also tie classes with several sections (or none known) to every section; off by default (faces rule)

Rows: teacher -> class + subject from the lms-timetable-extractor CSVs (no sections in any timetable, so a tie covers the whole
class), and class teachers where a timetable names them (LMS5 sheet names). The employee code comes from the timetable's roster
match when it is confident (>= 0.9) and the code is Active in the ERP staff master; otherwise emp_code stays blank (the row ties
nobody) and `fix` says what the Principal checks. No bus in-charges: no timetable has them.
Faces rule (V1/G2, 7 Nov): no timetable has sections, so by default a tie is seeded only where students_now shows the class
with exactly one section (the row names it); a class with several sections, or none known yet, becomes a fix row.
Names go only into the private Sheet. This prints counts, never names. Secrets: the extractor's data/secrets (never printed).
"""
import csv, json, os, re, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path

TT = Path.home() / "Library/CloudStorage/OneDrive-Personal/1. Projects/TT as on 19.09.2026/AI Redone TT"
CSM = Path.home() / "Projects/csm-extractor/data"
WORKBOOKS = {  # LMS1/LMS2: the newer of two workbooks (V1, 7 Nov)
    "LMS1": "UPDATED TIME TBALE", "LMS2": "LMS-2 TT Redone 2026f", "LMS3": "LMS 3 TT",
    "LMS4": "LMS4 Period Allotment 2026", "LMS5": "LMS 5 TIME TABLE", "LMS6": "LMS-6 Timetable Aug 2026",
}
HEADER = ["emp_code", "kind", "class", "section", "subject", "bus", "teacher", "fix"]
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
TEACHING = re.compile(r"^(?:P\s*D?\s*)?\d+$", re.I)  # PD1, PD 1, P1, 1: not assembly, lunch, break, dispersal
NOT_A_SUBJECT = re.compile(r"assembly|lunch|break|dispersal|recalling|annual function", re.I)


def erp_class(c):
    """'Class 10' -> 'X' (CSM's spelling, which writes "X - A"); 'M-I' stays."""
    m = re.match(r"^Class\s+(\d+)$", c.strip(), re.I)
    return ROMAN[int(m.group(1))] if m and 0 < int(m.group(1)) < len(ROMAN) else c.strip()


def rows_for(campus, whole_class=False):
    active = {r["emp_code"].strip().upper() for r in csv.DictReader(open(CSM / f"exports/sheets/{campus.lower()}/main/staff.csv"))
              if r["status"] == "Active"}
    tt = list(csv.DictReader(open(TT / f"{WORKBOOKS[campus]}__timetable.csv")))

    def code_and_fix(code, conf):
        code = code.strip().upper()
        if not code:
            return "", "no employee code in the timetable: add it"
        if float(conf or 0) < 0.9:
            return "", f"unsure name match: check code {code}"
        if code not in active:
            return "", f"code {code} is not Active in the ERP: check"
        return code, ""

    out = {}
    for r in tt:
        name, subj = r["Teacher"].strip(), r["Subject"].strip()
        if not name or not subj or not TEACHING.match(r["Period"].strip()) or NOT_A_SUBJECT.search(subj):
            continue
        code, fix = code_and_fix(r["TeacherEmployeeCode"], r["TeacherMatchConfidence"])
        out.setdefault((code or name.upper(), "subject", erp_class(r["Class"]), subj.upper()), [code, "subject", erp_class(r["Class"]), "", subj, "", name, fix])
    # class teachers: LMS5 names them in the sheet ("C2 <NAME> MA'AM"); match the first name to one timetable teacher
    for sheet, cls in {(r["SourceSheet"], r["Class"]) for r in tt}:
        m = re.match(r"^(?:C\d+|M\d+)\s+(.+?)\s+(?:MA'?AM|SIR)$", sheet.strip(), re.I)
        if not m:
            continue
        first = m.group(1).split()[0].upper()
        hits = {(r["TeacherEmployeeCode"], r["TeacherMatchConfidence"], r["Teacher"].strip()) for r in tt if r["Teacher"].strip().upper().split()[:1] == [first]}
        code, fix = code_and_fix(*list(hits)[0][:2]) if len(hits) == 1 else ("", "class teacher named in the timetable: add the code")
        out[(code or first, "class", erp_class(cls), "")] = [code, "class", erp_class(cls), "", "", "", list(hits)[0][2] if len(hits) == 1 else m.group(1).title(), fix]
    if not whole_class:
        sections = defaultdict(set)  # CSM class "X - A" -> X: {A}
        for s in csv.DictReader(open(CSM / f"exports/sheets/{campus.lower()}/main/students_now.csv")):
            if s["status"] == "Active" and s["class"].strip():
                sections[re.sub(r" - [A-Z0-9]+$", "", s["class"].strip().upper())].add(s["section"].strip().upper())
        for r in out.values():
            secs = sections.get(r[2].upper(), set())
            if r[0] and len(secs) == 1:
                r[3] = next(iter(secs))
            elif r[0]:
                r[7] = f"class has {len(secs)} sections: set the section, then the code {r[0]}" if secs else f"no sections for this class in the ERP yet: set the section, then the code {r[0]}"
                r[0] = ""
                r.append("section")  # counted, then dropped
    rows = sorted(out.values(), key=lambda x: (x[2], x[1], x[4], x[6]))
    return rows


def counts(rows):
    ok, section_fix = [r for r in rows if r[0]], sum(len(r) > len(HEADER) for r in rows)
    for r in rows:
        del r[len(HEADER):]
    return {"rows": len(rows), "teachers": len({r[0] for r in ok}), "class_sections": len({r[2] for r in ok}),
            "class_teachers": sum(r[1] == "class" for r in ok), "buses_with_in_charge": 0,
            "to_fix_rows": len(rows) - len(ok), "to_fix_for_section": section_fix, "to_fix_teachers": len({r[6].upper() for r in rows if not r[0]})}


def post(url, body):
    """The extractor's pattern: curl (no CA bundle in this Python); URL via stdin config, body via a 0600 temp file, so neither
    shows in `ps`. Apps Script answers a POST with a 302; -L follows it."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        os.chmod(f.name, 0o600)
        json.dump(body, f)
    try:
        cfg = f'url = "{url}"\ndata-binary = "@{f.name}"\nheader = "Content-Type: text/plain;charset=utf-8"\n'
        p = subprocess.run(["curl", "-s", "-L", "--max-time", "300", "-K", "-"], input=cfg, capture_output=True, text=True)
    finally:
        os.unlink(f.name)
    try:
        return json.loads(p.stdout)
    except ValueError:
        sys.exit(f"erppush: non-JSON answer (curl exit {p.returncode})")


def main():
    go, overwrite = "--go" in sys.argv, "--overwrite" in sys.argv
    plan = {c: rows_for(c, "--whole-class" in sys.argv) for c in WORKBOOKS}
    if go:
        url, secret = ((CSM / "secrets" / n).read_text().strip() for n in ("GAME_BACKEND_URL", "erp_push_secret"))
        chk = post(url, {"action": "erppush", "secret": secret, "mode": "check"})
        if not chk.get("success"):
            sys.exit("erppush check failed: " + str(chk.get("error", ""))[:80])
    for campus, rows in plan.items():
        c = counts(rows)
        if go:
            res = post(url, {"action": "erppush", "secret": secret, "campus": campus, "tab": "assignments", "mode": "replace",
                             "header": HEADER, "rows": rows, "part": 1, "parts": 1, "overwrite": overwrite})
            c["pushed"] = res.get("total") if res.get("success") else "REFUSED: " + str(res.get("error", ""))[:120]
        print(campus, json.dumps(c))
    if not go:
        print("dry run: nothing sent. Add --go.")


if __name__ == "__main__":
    main()
