#!/usr/bin/env python3
"""agency_import.py: the agencies' service workbook -> parts catalog. Plain asserts:
`/usr/local/bin/python3 -B transport/capture/test_agency_import.py` (pytest also collects them).
The fixture is built here with openpyxl in a temp dir, with the template's sheets and headers, its grey italic example row and
synthetic data for 2 fake models and fake buses (TEST01...). The real template is gitignored and never read by the tests."""
import contextlib, datetime, io, os, re, sys, tempfile
from pathlib import Path

import openpyxl
from openpyxl.styles import Font

sys.path.insert(0, str(Path(__file__).parent))
import agency_import as A

HEADERS = {
    "Our vehicles": ["Chassis no.", "Registration no.", "Model", "Variant", "Engine type", "Emission norm", "Year of manufacture",
                     "Warranty valid till (date)", "Warranty valid till (km)", "Open recalls / campaigns"],
    "Service history": ["Chassis no.", "Job card no.", "Date (DD-MM-YYYY)", "Odometer (km)", "Work done", "Part name", "Part number",
                        "Quantity", "Part amount (₹)", "Labour (₹)"],
    "Maintenance schedule": ["Code", "Model", "Item", "Normal: km", "Normal: months", "Severe / hill duty: km", "Severe / hill duty: months",
                             "Grade / specification", "Quantity", "Unit"],
    "Wear parts": ["Code", "Model", "Part", "Expected life on hill school-bus duty: km", "Expected life: months", "Part number", "Price (₹)",
                   "Labour to replace (₹)", "Genuine or alternate", "Notes (size, rating, brand)"],
    "Contacts": ["Agency / dealer", "Service advisor", "Phone", "Workshop (place)", "Nearest to our campus", "Workshop timings",
                 "Pick-up and drop?", "How to book"],
}
HEADER_ROW = {"Our vehicles": 3, "Service history": 3, "Maintenance schedule": 3, "Wear parts": 3, "Contacts": 1}
# the example row of the template (grey italic, first row under the headers); fake values here
EXAMPLE = {
    "Our vehicles": ["TESTCH…(17 chars)", "TESTREG", "LP 410/36 Starbus", "Skool 36", "3.8L CRAIL", "BS-VI", 2022, "11-03-2027", 200000, "None"],
    "Service history": ["TESTCH…", "JC-2026-1182", "05-09-2026", 81200, "10,000 km service", "Engine oil 15W-40", "9999…", "7 L", 3150, 700],
    "Maintenance schedule": ["engine_oil", "LP 410/36", "Engine oil", 20000, 12, 10000, 6, "15W-40 CI-4", 7, "litres"],
    "Wear parts": ["brake_front", "LP 410/36", "Brake linings / pads, front", 35000, 18, "9999…", 2400, 900, "Genuine", "Set of 4 liners"],
    "Contacts": ["Example Motors", "Advisor", "98xxxxxx10", "Place", "LMS X", "9-6", "Yes", "Call"],
}
# the template's hidden Code column (codes only: no private data) and what each one is for
TEMPLATE_SCHEDULE_CODES = ["engine_oil", "oil_filter", "fuel_filter", "air_filter", "coolant", "gearbox_oil", "axle_oil", "ps_fluid",
                           "brake_fluid", "clutch", "axle_grease", "belts", "def", "injector"]
TEMPLATE_WEAR_CODES = ["brake_front", "brake_rear", "brake_drum", "clutch", "tyre", "battery", "suspension", "leaf_spring", "steering",
                       "wheel_bearing", "prop_shaft", "starter_alternator", "radiator", "lights_wiring"]


def make_workbook(path, rows=None, mtime=None, over=None):
    """rows: {sheet: [row, ...]} filled in under the example row. The sheets and headers are the template's."""
    rows = rows or {}
    wb = openpyxl.Workbook()
    wb.active.title = "Read me"
    for name, head in HEADERS.items():
        ws = wb.create_sheet(name)
        if HEADER_ROW[name] == 3:  # an intro line, a gap, then the headers
            ws.append(["Intro line of the template"])
            ws.append([])
        ws.append(head)
        ws.append((over or {}).get(name) or EXAMPLE[name])  # `over`: data typed over the example row (it keeps the grey italic)
        for c in ws[ws.max_row]:
            c.font = Font(italic=True, color="7F7F7F")
        for r in rows.get(name, []):
            ws.append(r)
        if name in ("Maintenance schedule", "Wear parts"):
            ws.column_dimensions["A"].hidden = True
    wb.save(path)
    if mtime:
        os.utime(path, (mtime, mtime))
    return path


def tmp():
    return Path(tempfile.mkdtemp(prefix="agency-test-"))


def fixture(d, name="a.xlsx", mtime=None):
    """Two fake models, three fake buses."""
    return make_workbook(d / name, {
        "Our vehicles": [["TESTCH0001", "TEST01", "MODEL ALPHA 36", "Skool", "3.8L", "BS-VI", 2022, "11-03-2027", 200000, None],
                         ["TESTCH0002", "test 02", "MODEL BETA 26", None, None, "BS-IV", 2018, None, None, None],
                         [None] * 10],
        "Service history": [["TESTCH0001", "JC-1", "05-09-2026", "81,200", "10,000 km service", "Engine oil", "P1", "7 L", "₹ 3,150", 700],
                            ["TESTCH0001", "JC-1", "05-09-2026", 81200, "10,000 km service", "Oil filter", "P2", 1, 450, None],
                            ["TESTCH0002", "JC-2", "17-10-2026", 40000, "Brakes", "Liner", "P3", 4, 2400, 900],
                            [None] * 10],
        "Maintenance schedule": [
            ["engine_oil", "MODEL ALPHA 36", "Engine oil", 20000, 12, 10000, 6, "15W-40", 7, "litres"],   # severe present: wins
            ["oil_filter", None, "Oil filter", 20000, 12, None, None, None, 1, "nos"],                      # normal only; model carried down
            ["fuel_filter", None, "Fuel filter", None, None, None, None, None, None, None],                 # an untouched row
            ["engine_oil", "MODEL BETA 26", "Engine oil", 15000, 12, None, 6, "15W-40", 6, "litres"]],      # severe months only
        "Wear parts": [
            ["tyre", "MODEL ALPHA 36", "Tyre", 40000, 24, "T1", "₹ 9,500", 300, "Genuine", "10.00R20 16 ply"],
            ["brake_front", None, "Brake liners", 35000, 18, "B1", 2400, 900, "Genuine", ""],
            ["brake_front", "MODEL BETA 26", "Brake liners", 30000, 15, "B2", 2200, 800, "Alternate", ""]],
        "Contacts": [["Test Motors", "Advisor", "00000", "Testville", "LMS 9", "9-6", "Yes", "Call"], [None] * 8],
    }, mtime)


def model(parsed, name):
    return next(m for m in parsed["models"] if m["model"] == name)


def test_example_row_is_ignored():
    p = A.parse_agency(fixture(tmp()))
    assert [v["reg"] for v in p["vehicles"]] == ["TEST01", "TEST02"], p["vehicles"]
    assert all("EXAMPLE" not in m["model"] for m in p["models"])
    assert "JC-EXAMPLE" not in [h["jobCard"] for h in p["history"]]
    assert [c["agency"] for c in p["contacts"]] == ["Test Motors"]
    assert sorted(m["model"] for m in p["models"]) == ["MODEL ALPHA 36", "MODEL BETA 26"]
    assert p["problems"] == [], p["problems"]


def test_blank_rows_and_untouched_item_rows_are_skipped():
    p = A.parse_agency(fixture(tmp()))
    assert "fuel_filter" not in model(p, "MODEL ALPHA 36")["parts"], "an item the agency left empty is not a part"
    assert len(p["history"]) == 3 and len(p["vehicles"]) == 2


def test_severe_duty_interval_wins_over_normal_when_present():
    p = A.parse_agency(fixture(tmp()))
    a, b = model(p, "MODEL ALPHA 36")["parts"], model(p, "MODEL BETA 26")["parts"]
    assert (a["engine_oil"]["lifeKm"], a["engine_oil"]["lifeMonths"]) == (10000, 6), "severe km and months beat normal"
    assert (a["oil_filter"]["lifeKm"], a["oil_filter"]["lifeMonths"]) == (20000, 12), "normal when there is no severe"
    assert (b["engine_oil"]["lifeKm"], b["engine_oil"]["lifeMonths"]) == (15000, 6), "per field: severe months, normal km"
    assert a["engine_oil"]["spec"] == "15W-40"


def test_wear_parts_carry_life_price_labour_and_the_money_is_plain_numbers():
    p = A.parse_agency(fixture(tmp()))
    t = model(p, "MODEL ALPHA 36")["parts"]["tyre"]
    assert (t["lifeKm"], t["lifeMonths"], t["price"], t["labour"]) == (40000, 24, 9500, 300), t
    assert model(p, "MODEL ALPHA 36")["parts"]["brake_front"]["price"] == 2400, "model carried down the block"
    assert model(p, "MODEL BETA 26")["parts"]["brake_front"]["labour"] == 800


def test_vehicles_and_history_dates_money_and_reg_by_chassis():
    p = A.parse_agency(fixture(tmp()))
    v = p["vehicles"][0]
    assert (v["chassis"], v["reg"], v["model"], v["year"], v["warrantyDate"], v["warrantyKm"]) == ("TESTCH0001", "TEST01", "MODEL ALPHA 36", 2022, "2027-03-11", 200000), v
    assert p["vehicles"][1]["reg"] == "TEST02", "spaces dropped, upper case"
    h = p["history"]
    assert (h[0]["date"], h[0]["odometer"], h[0]["partAmount"], h[0]["labour"], h[0]["qty"], h[0]["reg"]) == ("2026-09-05", 81200, 3150, 700, "7 L", "TEST01"), h[0]
    assert h[1]["labour"] is None and h[2]["reg"] == "TEST02", "the reg comes from the vehicles sheet by chassis"


def test_a_row_with_text_in_a_km_column_is_reported_not_imported():
    d = tmp()
    path = make_workbook(d / "bad.xlsx", {
        "Wear parts": [["tyre", "MODEL ALPHA 36", "Tyre", "about forty thousand", 24, None, 9500, 300, None, None],
                       ["battery", "MODEL ALPHA 36", "Battery", 60000, 24, None, 7000, 0, None, None]],
        "Maintenance schedule": [["coolant", "MODEL ALPHA 36", "Coolant", "20k", 12, None, None, None, None, None]],
        "Service history": [["TESTCH0001", "JC-9", "31-02-2026", 100, "x", "Part", None, 1, 10, 0],
                            ["TESTCH0001", "JC-10", "01-02-2026", "n/a", "x", "Part", None, 1, 10, 0]]})
    p = A.parse_agency(path)
    parts = model(p, "MODEL ALPHA 36")["parts"]
    assert set(parts) == {"battery"}, "the bad rows are not imported; the good one is"
    assert p["history"] == [], "a date that is not a date, and a km that is not a number, are not imported either"
    text = "\n".join(p["problems"])
    assert len(p["problems"]) == 4, p["problems"]
    assert re.search(r"Wear parts row 5.*about forty thousand", text), text
    assert re.search(r"Maintenance schedule row 5.*20k", text), text


def test_two_files_for_the_same_model_merge_newest_file_wins_per_part():
    d = tmp()
    old = make_workbook(d / "old.xlsx", {"Wear parts": [["tyre", "MODEL ALPHA 36", "Tyre", 30000, 24, None, 9000, 300, None, None],
                                                        ["clutch", "MODEL ALPHA 36", "Clutch", 80000, 36, None, 12000, 2000, None, None]]}, mtime=1_700_000_000)
    new = make_workbook(d / "new.xlsx", {"Wear parts": [["tyre", "MODEL ALPHA 36", "Tyre", 45000, 24, None, 9800, 300, None, None],
                                                        ["battery", "MODEL ALPHA 36", "Battery", 60000, 24, None, 7000, 0, None, None]]}, mtime=1_800_000_000)
    for order in ([old, new], [new, old]):  # the file order does not decide
        m = A.merge([A.parse_agency(f) for f in order])
        parts = next(x for x in m["models"] if x["model"] == "MODEL ALPHA 36")["parts"]
        assert parts["tyre"]["lifeKm"] == 45000 and parts["tyre"]["price"] == 9800, "the newer file wins the part"
        assert parts["clutch"]["lifeKm"] == 80000, "a part only the older file has is kept"
        assert parts["battery"]["lifeKm"] == 60000
        assert len(m["models"]) == 1


def test_merge_does_not_duplicate_vehicles_or_history():
    d = tmp()
    a = A.parse_agency(fixture(d, "a.xlsx"))
    b = A.parse_agency(fixture(d, "b.xlsx"))
    m = A.merge([a, b])
    assert (len(m["vehicles"]), len(m["history"])) == (2, 3), "the same file twice is the same data"


def test_component_codes_map_to_task_1_ids():
    gs = (Path(__file__).resolve().parents[2] / "apps-script" / "office-config.gs").read_text()
    block = gs.split("var OFFICE_COMPONENTS = [", 1)[1].split("\n];", 1)[0]
    task1 = set(re.findall(r"\['([a-z_]+)', '[^']*', (?:OFFICE_SERVICE_CATS_|\[)", block))
    assert "tyre_spare" in task1 and len(task1) > 25, task1
    assert set(A.OFFICE_IDS) == task1, "the copy of Task 1's ids here has drifted from OFFICE_COMPONENTS"
    assert A.components_for("tyre") == ["tyre_fl", "tyre_fr", "tyre_rl", "tyre_rr", "tyre_spare"]
    assert A.components_for("leaf_spring") == ["suspension"]
    assert A.components_for("brake_drum") == ["brake_front", "brake_rear"]
    assert A.components_for("engine_oil") == ["engine_oil"] and A.components_for(" Clutch ") == ["clutch"]
    catalog_only = [c for c in TEMPLATE_SCHEDULE_CODES + TEMPLATE_WEAR_CODES if not A.components_for(c)]
    assert sorted(set(catalog_only)) == ["axle_oil", "def", "injector", "prop_shaft", "ps_fluid", "radiator"], catalog_only
    for c in TEMPLATE_SCHEDULE_CODES + TEMPLATE_WEAR_CODES:
        assert set(A.components_for(c)) <= task1, c
    parts = model(A.parse_agency(fixture(tmp())), "MODEL ALPHA 36")["parts"]
    assert parts["tyre"]["components"] == ["tyre_fl", "tyre_fr", "tyre_rl", "tyre_rr", "tyre_spare"]
    assert parts["tyre"]["asOf"], "every part says which file's date it comes from"


@contextlib.contextmanager
def post_stub(fn):
    """capture.post is the module's own object (test_capture.py shares it): put it back afterwards."""
    old = A.capture.post
    A.capture.post = fn
    try:
        yield
    finally:
        A.capture.post = old


def cli(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = A.main([str(a) for a in args])
    return code, out.getvalue()


def test_cli_dry_run_prints_a_summary_and_pushes_nothing():
    f = fixture(tmp())
    with post_stub(lambda *a, **k: (_ for _ in ()).throw(AssertionError("a dry run must not push"))):
        code, text = cli(f)
    assert code == 0
    assert "2 models" in text and "2 vehicles" in text and "3 history" in text and "dry run" in text.lower(), text
    assert "₹" not in text and "3150" not in text, "the summary carries counts, not money"


def test_cli_push_sends_the_payload_and_a_refused_push_exits_non_zero():
    f = fixture(tmp())
    sent = []
    with post_stub(lambda action, payload=None: sent.append((action, payload)) or {"success": True, "parts": 5}):
        assert cli(f, "--push")[0] == 0
    assert sent[0][0] == "transportcatalogpush" and set(sent[0][1]) == {"models", "vehicles", "history"}, sent
    assert "contacts" not in sent[0][1], "the advisors' phone numbers stay on the Mac"
    assert all(set(v).isdisjoint({"file", "row"}) and v["asOf"] for v in sent[0][1]["vehicles"]), "bookkeeping keys are not pushed; asOf is"
    assert all(h["asOf"] for h in sent[0][1]["history"]), "the backend keeps the newest asOf per row"
    assert all(set(h).isdisjoint({"file", "row"}) for h in sent[0][1]["history"])
    assert sent[0][1]["vehicles"][0]["catalogModel"] == "MODEL ALPHA 36"
    with post_stub(lambda action, payload=None: sys.exit(f"{action} refused: Not authorized")):
        try:
            cli(f, "--push")
        except SystemExit as e:
            assert e.code not in (0, None), e.code
        else:
            raise AssertionError("a refused push must exit non-zero")


# ── fix round 1 ──
def test_a_model_typed_on_a_row_with_no_data_carries_down_to_the_block():  # I1
    d = tmp()
    path = make_workbook(d / "blocks.xlsx", {"Wear parts": [
        ["tyre", "MODEL ALPHA 36", "Tyre", 40000, 24, None, 9500, 300, None, None],
        ["battery", None, "Battery", 40000, 24, None, 7000, 0, None, None],
        ["tyre", "MODEL BETA 26", "Tyre", None, None, None, None, None, None, None],   # model typed, nothing tracked for the tyre
        ["battery", None, "Battery", 50000, 30, None, 7500, 0, None, None]]})
    p = A.parse_agency(path)
    assert model(p, "MODEL ALPHA 36")["parts"]["battery"]["lifeKm"] == 40000, "block 2 must not overwrite block 1"
    assert model(p, "MODEL BETA 26")["parts"]["battery"]["lifeKm"] == 50000
    assert p["problems"] == [], p["problems"]


def test_a_second_block_without_a_model_is_reported_not_merged_into_the_first():  # I1, ambiguity
    d = tmp()
    path = make_workbook(d / "nomodel.xlsx", {"Wear parts": [
        ["battery", "MODEL ALPHA 36", "Battery", 40000, 24, None, 7000, 0, None, None],
        ["battery", None, "Battery", 50000, 30, None, 7500, 0, None, None]]})
    p = A.parse_agency(path)
    assert model(p, "MODEL ALPHA 36")["parts"]["battery"]["lifeKm"] == 40000, "the first stays"
    assert len(p["problems"]) == 1 and re.search(r"nomodel\.xlsx: Wear parts row 6.*battery.*twice", p["problems"][0]), p["problems"]


def test_registrations_lose_every_non_alphanumeric_character():  # I2
    assert A.reg_id("HP-66-5805") == "HP665805" and A.reg_id(" hp 66.5805 ") == "HP665805" and A.reg_id(None) is None
    d = tmp()
    path = make_workbook(d / "regs.xlsx", {
        "Our vehicles": [["TESTCH0009", "HP-66-5805", "MODEL ALPHA 36", None, None, None, 2020, None, None, None]],
        "Service history": [["TESTCH0009", "JC-5", "01-10-2026", 100, "x", "Part", None, 1, 10, 0]]})
    p = A.parse_agency(path)
    assert (p["vehicles"][0]["reg"], p["history"][0]["reg"]) == ("HP665805", "HP665805")


def test_every_problem_line_names_its_file_sheet_and_row():  # I3
    d = tmp()
    path = make_workbook(d / "nine.xlsx", {"Wear parts": [["tyre", "MODEL ALPHA 36", "Tyre", "lots", 24, None, 1, 1, None, None]],
                                           "Service history": [["TESTCH0001", "JC-1", "not a date", 1, "x", "P", None, 1, 1, 1]]})
    p = A.parse_agency(path)
    assert len(p["problems"]) == 2
    assert all(x.startswith("nine.xlsx: ") for x in p["problems"]), p["problems"]
    assert "nine.xlsx: Wear parts row 5" in p["problems"][0] or "nine.xlsx: Wear parts row 5" in p["problems"][1]
    m = A.merge([p, A.parse_agency(fixture(d, "other.xlsx"))])
    assert all(x.split(":")[0] in ("nine.xlsx", "other.xlsx") for x in m["problems"])


def test_the_example_row_is_known_by_its_values_not_its_font():  # I4
    d = tmp()
    plain = make_workbook(d / "plain.xlsx")                      # untouched example rows, italic
    wb = openpyxl.load_workbook(plain)
    for ws in wb:
        for c in ws[ws.max_row]:
            c.font = Font(italic=False)                            # an agency's re-save loses the formatting
    wb.save(plain)
    p = A.parse_agency(plain)
    assert (p["models"], p["vehicles"], p["history"], p["contacts"], p["problems"]) == ([], [], [], [], []), "still recognised"
    assert len(p["notes"]) == 5 and all("example row" in n and n.startswith("plain.xlsx: ") for n in p["notes"]), p["notes"]
    typed = make_workbook(d / "typed.xlsx", over={
        "Our vehicles": ["TESTCH0001", "TEST01", "MODEL ALPHA 36", None, None, None, 2022, None, None, None],
        "Maintenance schedule": ["engine_oil", "MODEL ALPHA 36", "Engine oil", 15000, 12, None, None, None, None, None],
        "Wear parts": ["brake_front", "MODEL ALPHA 36", "Brake", 30000, 15, None, 2000, 700, None, None]})
    p = A.parse_agency(typed)                                      # typed over the example row: still italic
    assert [v["reg"] for v in p["vehicles"]] == ["TEST01"], "data typed over the example row is imported"
    parts = model(p, "MODEL ALPHA 36")["parts"]
    assert parts["engine_oil"]["lifeKm"] == 15000 and parts["brake_front"]["price"] == 2000
    assert not any("Our vehicles" in n for n in p["notes"])


def test_a_vehicle_model_resolves_to_the_catalog_key_exact_then_unique_prefix_else_reported():  # Ruling 39
    d = tmp()
    wear = lambda m: ["battery", m, "Battery", 40000, 24, None, 1, 0, None, None]
    veh = lambda ch, reg, m: [ch, reg, m, None, None, None, 2020, None, None, None]
    path = make_workbook(d / "res.xlsx", {
        "Wear parts": [wear("LP 410/36"), wear("LP 1618"), wear("LP 1618 Cowl")],
        "Our vehicles": [veh("TESTCH1", "T1", "LP 410/36 Starbus"), veh("TESTCH2", "T2", "lp 410/36"), veh("TESTCH3", "T3", "LP 1618 Cowl Skool"),
                         veh("TESTCH4", "T4", "Unknown Model"), veh("TESTCH5", "T5", None)]})
    m = A.merge([A.parse_agency(path)])
    key = {v["reg"]: v["catalogModel"] for v in m["vehicles"]}
    assert key["T1"] == "LP 410/36", "a unique prefix match"
    assert key["T2"] == "LP 410/36", "an exact match ignores case"
    assert key["T3"] == "" and key["T4"] == "" and key["T5"] == "", "no unique match: no key"
    assert A.catalog_key("LP 1618", ["LP 1618 Cowl"])[0] == "LP 1618 Cowl" and A.catalog_key("LP 1618 Cowl", ["LP 1618"])[0] == "LP 1618", "at a word boundary"
    assert A.catalog_key("LP 16180", ["LP 1618"])[0] == "" and A.catalog_key("LP 1618", ["LP 16180"])[0] == "", "not in the middle of a word"
    assert A.catalog_key("LP 410/36 Starbus", ["LP 410/36"])[0] == "LP 410/36" and A.catalog_key("LP 410", ["LP 410/36"])[0] == "LP 410/36", "a slash is a boundary"
    text = "\n".join(m["problems"])
    assert re.search(r"res\.xlsx: Our vehicles row 7.*T3.*LP 1618 Cowl Skool.*more than one", text), text
    assert re.search(r"T4.*Unknown Model.*no catalog model", text) and re.search(r"T5.*no model", text), text


def test_as_of_overrides_the_file_time():  # Ruling 39
    d = tmp()
    f = fixture(d, mtime=1_700_000_000)
    assert model(A.parse_agency(f), "MODEL ALPHA 36")["parts"]["tyre"]["asOf"].startswith("2023-11-1"), "default: the file's time"
    p = A.parse_agency(f, as_of="2026-10-01")
    assert model(p, "MODEL ALPHA 36")["parts"]["tyre"]["asOf"] == "2026-10-01T00:00:00"
    sent = []
    with post_stub(lambda action, payload=None: sent.append(payload) or {"success": True}):
        cli(f, "--as-of", "2026-10-01", "--push")
    assert {x["asOf"] for m in sent[0]["models"] for x in m["parts"].values()} == {"2026-10-01T00:00:00"}
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            cli(f, "--as-of", "01-10-2026")
    except SystemExit as e:
        assert e.code != 0
    else:
        raise AssertionError("--as-of takes YYYY-MM-DD")


def test_a_reg_that_will_not_resolve_is_reported_and_left_for_the_portal_to_find():  # M1
    d = tmp()
    path = make_workbook(d / "noreg.xlsx", {
        "Our vehicles": [["TESTCH0001", "TEST01", "MODEL ALPHA 36", None, None, None, 2022, None, None, None],
                         ["TESTCH0003", None, "MODEL ALPHA 36", None, None, None, 2022, None, None, None]],
        "Wear parts": [["battery", "MODEL ALPHA 36", "Battery", 1, 1, None, 1, 0, None, None]],
        "Service history": [["TESTCH0001", "JC-1", "01-10-2026", 1, "x", "P", None, 1, 1, 1],
                            ["TESTCH0777", "JC-2", "01-10-2026", 1, "x", "P", None, 1, 1, 1]]})
    m = A.merge([A.parse_agency(path)])
    assert [v["reg"] for v in m["vehicles"]] == ["TEST01"]
    assert [(h["chassis"], h["reg"]) for h in m["history"]] == [("TESTCH0001", "TEST01"), ("TESTCH0777", "")], \
        "a chassis not on these sheets is still sent: the portal may know it from an earlier push (and keeps the row only if it does)"
    text = "\n".join(m["problems"])
    assert re.search(r"noreg\.xlsx: Our vehicles row 6.*no registration", text), text
    assert re.search(r"noreg\.xlsx: Service history row 6.*TESTCH0777.*not on.*earlier push", text), text


def test_a_part_code_the_backend_would_refuse_is_reported_and_left_out():  # N2
    d = tmp()
    path = make_workbook(d / "code.xlsx", {"Wear parts": [["brake|front", "MODEL ALPHA 36", "x", 1, 1, None, 1, 1, None, None],
                                                           ["battery", "MODEL ALPHA 36", "Battery", 1, 1, None, 1, 1, None, None]],
                                           "Maintenance schedule": [["engine oil", "MODEL ALPHA 36", "x", 1, 1, None, None, None, None, None]]})
    p = A.parse_agency(path)
    assert list(model(p, "MODEL ALPHA 36")["parts"]) == ["battery"]
    assert len(p["problems"]) == 2 and all(re.search(r"code\.xlsx: .* row 5: .*code", x) for x in p["problems"]), p["problems"]


def test_a_dash_in_a_price_cell_means_empty_but_text_in_a_km_cell_still_does_not():  # M5
    d = tmp()
    path = make_workbook(d / "dash.xlsx", {"Wear parts": [
        ["battery", "MODEL ALPHA 36", "Battery", 60000, 24, None, "-", "N/A", None, None],
        ["clutch", "MODEL ALPHA 36", "Clutch", "-", 36, None, 100, 1, None, None]]})
    p = A.parse_agency(path)
    b = model(p, "MODEL ALPHA 36")["parts"]["battery"]
    assert (b["lifeKm"], b["price"], b["labour"]) == (60000, None, None), "life kept, money empty"
    assert "clutch" not in model(p, "MODEL ALPHA 36")["parts"] and len(p["problems"]) == 1, p["problems"]


def test_a_vehicle_in_two_files_takes_the_newer_file_whatever_the_order():  # M6
    d = tmp()
    row = lambda y: {"Our vehicles": [["TESTCH0001", "TEST01", "MODEL ALPHA 36", None, None, None, y, None, None, None]]}
    old = A.parse_agency(make_workbook(d / "o.xlsx", row(2019), mtime=1_700_000_000))
    new = A.parse_agency(make_workbook(d / "n.xlsx", row(2022), mtime=1_800_000_000))
    for order in ([old, new], [new, old]):
        assert A.merge(order)["vehicles"][0]["year"] == 2022


def test_excel_date_cells_and_an_inserted_column():  # M3
    d = tmp()
    path = make_workbook(d / "xl.xlsx", {
        "Service history": [["TESTCH0001", "JC-1", datetime.datetime(2026, 9, 5), 1, "x", "P", None, 1, 1, 1]],
        "Our vehicles": [["TESTCH0001", "TEST01", "MODEL ALPHA 36", None, None, None, 2022, datetime.date(2027, 3, 11), None, None]],
        "Wear parts": [["tyre", "MODEL ALPHA 36", "Tyre", 40000, 24, None, 9500, 300, None, None]]})
    wb = openpyxl.load_workbook(path)
    wb["Wear parts"].insert_cols(2)                                # an agency adds a column of its own
    wb["Wear parts"]["B3"] = "Agency note"
    wb.save(path)
    p = A.parse_agency(path)
    assert (p["history"][0]["date"], p["vehicles"][0]["warrantyDate"]) == ("2026-09-05", "2027-03-11")
    t = model(p, "MODEL ALPHA 36")["parts"]["tyre"]
    assert (t["lifeKm"], t["price"]) == (40000, 9500) and p["problems"] == [], (t, p["problems"])


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print("ok  ", name)
        except Exception as e:  # report every test, then fail the run
            failed += 1
            print("FAIL", name, "-", type(e).__name__, e)
    print(f"{len(tests) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
