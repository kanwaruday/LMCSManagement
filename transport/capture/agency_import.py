#!/usr/bin/env python3
"""Agency service data -> the parts catalog. The vehicle agencies' service centres fill the Excel template
(transport/game-data/Service centre data template (agencies).xlsx: Our vehicles, Service history, Maintenance schedule, Wear parts,
Service packages, Running norms, Contacts). This reads one or more filled files and pushes them to the portal (POST
transportcatalogpush, same secret and helper as capture.py) as the parts catalog the garage reads:
catalog.models[model].parts[code] = {lifeKm, lifeMonths, price, labour, spec, components, asOf}.

  /usr/local/bin/python3 transport/capture/agency_import.py FILE.xlsx [FILE2.xlsx ...]          # dry run: a summary, nothing sent
  /usr/local/bin/python3 transport/capture/agency_import.py FILE.xlsx [FILE2.xlsx ...] --push   # send it (exit non-zero if refused)
  /usr/local/bin/python3 transport/capture/test_agency_import.py                                 # tests (framework 3.13: has openpyxl)

Reading rules: the grey italic example row and blank rows are skipped. Dates are DD-MM-YYYY, money is rupees with or without ₹ and
commas. A row with text where a number belongs (km, months, price, labour, odometer, amount) or a date that is not a date is NOT
imported; it is listed under "not imported" so the agency can fix it. The Model column of an item block may be filled on the first
row only (it carries down). Maintenance schedule: the severe/hill-duty interval wins over the normal one when present, per field.
Wear parts give the replacement life, price and labour, and win over the schedule for the same model and part. Several files for
one model merge, the newest file (by its modified time, kept as asOf) winning per part.

The template's codes stay the catalog keys; each part also carries `components`, the Task 1 ids (OFFICE_COMPONENTS in
apps-script/office-config.gs) the garage matches service bills against. Contacts (advisors' phone numbers) and the packages and
norms sheets are not pushed. Money is business data for the private Sheet only. Nothing here computes speed.
"""
import argparse, datetime as dt, re, sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture  # post(): the secret from ~/.lmcs/transport_push_secret, curl --data-binary @-, exits non-zero if refused

# Task 1's ids, OFFICE_COMPONENTS in apps-script/office-config.gs (test_agency_import.py fails if this copy drifts)
OFFICE_IDS = frozenset("""engine_oil oil_filter fuel_filter air_filter coolant belts brake_front brake_rear brake_fluid clutch gearbox_oil
axle_grease suspension steering wheel_bearing battery lights_wiring starter_alternator tyre_fl tyre_fr tyre_rl tyre_rr tyre_spare
puncture body_paint seats_windows door washing_greasing other""".split())
# template code -> Task 1 ids where they differ (Ruling 2). Any other code maps to itself when that is a Task 1 id; the rest stay
# catalog-only (axle_oil, ps_fluid, def, injector, prop_shaft, radiator in today's template).
CODE_MAP = {"tyre": ["tyre_fl", "tyre_fr", "tyre_rl", "tyre_rr", "tyre_spare"], "leaf_spring": ["suspension"], "brake_drum": ["brake_front", "brake_rear"]}

SHEETS = {
    "vehicles": ("Our vehicles", {"chassis": "chassis", "reg": "registration", "model": "model", "variant": "variant", "engine": "engine",
                                  "emission": "emission", "year": "year", "warrantyDate": "warranty valid till (date", "warrantyKm": "warranty valid till (km",
                                  "recalls": "open recalls"}),
    "history": ("Service history", {"chassis": "chassis", "jobCard": "job card", "date": "date", "odometer": "odometer", "work": "work done",
                                    "part": "part name", "partNo": "part number", "qty": "quantity", "partAmount": "part amount", "labour": "labour"}),
    "schedule": ("Maintenance schedule", {"code": "code", "model": "model", "nKm": "normal: km", "nMo": "normal: months",
                                          "sKm": "severe / hill duty: km", "sMo": "severe / hill duty: months", "spec": "grade"}),
    "wear": ("Wear parts", {"code": "code", "model": "model", "km": "expected life on", "mo": "expected life: m", "price": "price",
                            "labour": "labour", "notes": "notes"}),
    "contacts": ("Contacts", {"agency": "agency", "advisor": "service advisor", "phone": "phone", "place": "workshop (place", "nearest": "nearest",
                              "timings": "workshop timings", "pickup": "pick-up", "booking": "how to book"}),
}
HISTORY_KEY = ("chassis", "jobCard", "date", "part", "partNo", "qty")


def components_for(code):
    c = str(code or "").strip().lower()
    return list(CODE_MAP[c]) if c in CODE_MAP else [c] if c in OFFICE_IDS else []


def text(v):
    s = " ".join(str(v).split()) if v is not None else ""
    return s or None


def number(v):
    """None for an empty cell, an int/float for a number (₹, commas, a trailing km/months allowed); ValueError for anything else."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, bool):
        raise ValueError(f"{v!r} is not a number")
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else v
    m = re.fullmatch(r"₹?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:km|kms|months?|mo)?", str(v).strip().lower())
    if not m:
        raise ValueError(f"{str(v).strip()!r} is not a number")
    f = float(m[1].replace(",", ""))
    return int(f) if f.is_integer() else f


def date(v):
    """ISO yyyy-mm-dd from a DD-MM-YYYY text (or an Excel date); None for an empty cell; ValueError otherwise."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", str(v).strip())
    try:
        return dt.date(int(m[3]), int(m[2]), int(m[1])).isoformat()
    except (TypeError, ValueError):
        raise ValueError(f"{str(v).strip()!r} is not a DD-MM-YYYY date") from None


def ident(v):  # chassis and registration numbers: no spaces, upper case
    s = re.sub(r"\s+", "", str(v)).upper() if v is not None else ""
    return s or None


def table(wb, key, data):
    """Yields (row number, {field: raw value}) for the real rows of a sheet: below its header row (found by header text, so a changed
    intro line does not matter), no grey italic example, no row without any of the `data` fields. A missing sheet gives nothing."""
    name, fields = SHEETS[key]
    if name not in wb.sheetnames:
        return
    ws = wb[name]
    for hr in range(1, 8):
        heads = [" ".join(str(c.value or "").lower().split()) for c in ws[hr]]
        cols = {f: next((i for i, h in enumerate(heads) if h.startswith(p)), None) for f, p in fields.items()}
        if all(i is not None for i in cols.values()):
            break
    else:
        raise ValueError(f"sheet '{name}': the column headers were not found (do not rename the columns)")
    for row in ws.iter_rows(min_row=hr + 1):
        if any(c.font and c.font.i for c in row if c.value is not None):  # the grey italic example
            continue
        vals = {f: row[i].value if i < len(row) else None for f, i in cols.items()}
        if any(text(vals[f]) for f in data):
            yield row[0].row, vals


def parse_agency(path):
    """One filled workbook -> {models, vehicles, history, contacts, problems}. models: [{model, parts: {code: {lifeKm, lifeMonths,
    price, labour, spec, components, asOf}}}]; problems: one line per row left out and why."""
    path = Path(path)
    wb = openpyxl.load_workbook(path, data_only=True)
    as_of = dt.datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%dT%H:%M:%S")
    out = {"models": [], "vehicles": [], "history": [], "contacts": [], "problems": []}
    bad = lambda sheet, n, why: out["problems"].append(f"{sheet} row {n}: {why}")

    def guarded(key, data):
        try:
            yield from table(wb, key, data)
        except ValueError as e:
            out["problems"].append(str(e))

    for n, r in guarded("vehicles", list(SHEETS["vehicles"][1])):
        try:
            v = {"chassis": ident(r["chassis"]), "reg": ident(r["reg"]), "model": text(r["model"]), "variant": text(r["variant"]),
                 "engine": text(r["engine"]), "emission": text(r["emission"]), "year": number(r["year"]), "warrantyDate": date(r["warrantyDate"]),
                 "warrantyKm": number(r["warrantyKm"]), "recalls": text(r["recalls"])}
        except ValueError as e:
            bad("Our vehicles", n, e)
            continue
        if not v["chassis"]:
            bad("Our vehicles", n, "no chassis number")
        else:
            out["vehicles"].append(v)
    reg_of = {v["chassis"]: v["reg"] for v in out["vehicles"]}

    for n, r in guarded("history", list(SHEETS["history"][1])):
        try:
            h = {"chassis": ident(r["chassis"]), "jobCard": text(r["jobCard"]), "date": date(r["date"]), "odometer": number(r["odometer"]),
                 "work": text(r["work"]), "part": text(r["part"]), "partNo": text(r["partNo"]), "qty": text(r["qty"]),
                 "partAmount": number(r["partAmount"]), "labour": number(r["labour"])}
        except ValueError as e:
            bad("Service history", n, e)
            continue
        if not (h["chassis"] and h["date"]):
            bad("Service history", n, "needs a chassis number and a date")
        else:
            h["reg"] = reg_of.get(h["chassis"], "")
            out["history"].append(h)

    models = {}
    for key, sheet, data, extract in (
            ("schedule", "Maintenance schedule", ["nKm", "nMo", "sKm", "sMo", "spec"],
             lambda r: {"lifeKm": first(number(r["sKm"]), number(r["nKm"])), "lifeMonths": first(number(r["sMo"]), number(r["nMo"])), "spec": text(r["spec"])}),
            ("wear", "Wear parts", ["km", "mo", "price", "labour", "notes"],
             lambda r: {"lifeKm": number(r["km"]), "lifeMonths": number(r["mo"]), "price": number(r["price"]), "labour": number(r["labour"]), "spec": text(r["notes"])})):
        model = None  # ponytail: the Model column may be filled on the first row of a block only; it carries down, never from the example row
        for n, r in guarded(key, data):
            model = " ".join(str(r["model"]).split()) if text(r["model"]) else model
            code = text(r["code"]) and text(r["code"]).lower()
            try:
                vals = extract(r)
            except ValueError as e:
                bad(sheet, n, f"{code}: {e}")
                continue
            if not (code and model):
                bad(sheet, n, "needs a code and a model")
                continue
            p = models.setdefault(model, {}).setdefault(code, {"lifeKm": None, "lifeMonths": None, "price": None, "labour": None, "spec": None})
            p.update({k: v for k, v in vals.items() if v is not None})  # the wear sheet is read last: its life, price and labour win
    out["models"] = [{"model": m, "parts": {c: dict(p, components=components_for(c), asOf=as_of) for c, p in parts.items()}} for m, parts in models.items()]

    for n, r in guarded("contacts", list(SHEETS["contacts"][1])):
        out["contacts"].append({k: text(v) for k, v in r.items()})
    return out


def first(*vals):
    return next((v for v in vals if v is not None), None)


def merge(parsed):
    """Several parse_agency results -> one {models, vehicles, history, contacts, problems}. Per model and part the newest asOf wins
    (a tie: the later file). Vehicles by chassis and history rows by job card line are listed once (the later file wins)."""
    models, vehicles, history = {}, {}, {}
    for p in parsed:
        for m in p["models"]:
            mine = models.setdefault(m["model"], {})
            for code, part in m["parts"].items():
                if code not in mine or part["asOf"] >= mine[code]["asOf"]:
                    mine[code] = part
        vehicles.update({v["chassis"]: v for v in p["vehicles"]})
        history.update({tuple(h.get(k) for k in HISTORY_KEY): h for h in p["history"]})
    reg_of = {c: v["reg"] for c, v in vehicles.items() if v["reg"]}
    for h in history.values():
        h["reg"] = h.get("reg") or reg_of.get(h["chassis"], "")
    return {"models": [{"model": m, "parts": parts} for m, parts in models.items()], "vehicles": list(vehicles.values()), "history": list(history.values()),
            "contacts": [c for p in parsed for c in p["contacts"]], "problems": [x for p in parsed for x in p["problems"]]}


def summary(label, p):
    parts = sum(len(m["parts"]) for m in p["models"])
    return (f"{label}: {len(p['models'])} models ({parts} parts), {len(p['vehicles'])} vehicles, {len(p['history'])} history rows, "
            f"{len(p['contacts'])} contacts")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="+", help="filled agency workbook(s) (.xlsx)")
    ap.add_argument("--push", action="store_true", help="send it to the portal (default: a dry run that prints a summary)")
    a = ap.parse_args(argv)
    parsed = [parse_agency(f) for f in a.files]
    for f, p in zip(a.files, parsed):
        print(summary(Path(f).name, p))
    m = merge(parsed)
    print(summary("total", m))
    if m["problems"]:
        print(f"{len(m['problems'])} rows not imported (ask the agency to fix them):")
        for line in m["problems"]:
            print("  -", line)
    if not a.push:
        print("dry run: nothing sent (add --push to send it)")
        return 0
    res = capture.post("transportcatalogpush", {k: m[k] for k in ("models", "vehicles", "history")})
    print("pushed:", {k: v for k, v in res.items() if k != "success"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
