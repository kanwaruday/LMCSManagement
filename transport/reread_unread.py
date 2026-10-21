#!/usr/bin/env python3
"""Re-read the Transport scans whose date the first LM Studio pass could not read.

The first pass (drive-index/local_summarize_pass.py) looks at page 1 of a PDF at 150 dpi with a general "extract everything"
prompt. This pass opens every page at 200 dpi and asks one narrow question: what is this document, and until when is it valid?
It does NOT invent dates: an answer is only accepted as a date if the document prints it (the model must quote the words
that carry it, and the quote must contain the year). Each scan ends in exactly one outcome, stored in
drive-index/transport_reread.json (keyed by Drive file id) and merged into the fleet push by export_fleet.py:

  date            a valid-until date is printed and was read
  no_expiry       the right kind of document, but no expiry is printed (a speed governor fitment certificate, for example)
  other_document  the file is not the paper its folder/name says (a fitness *refusal* letter, an insurance claim form...)
  illegible       cannot be read reliably; stays "unread" on the page
  error           the model call failed; retried on the next run, up to MAX_ATTEMPTS

Resolved files are not read again unless the file changes. Called by the AI Coordinator (ai-coordinator/run.sh) before the
fleet push; safe to run by hand:

  python3 transport/reread_unread.py              # read everything unresolved
  python3 transport/reread_unread.py --only HP66A7531 --limit 3
  python3 transport/reread_unread.py --force      # read everything again
  python3 transport/reread_unread.py --selftest   # parser checks, no LM Studio
"""
import argparse, json, re, sqlite3, subprocess, sys, tempfile, time
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "drive-index"))
from build_master import DB, DB_TYPES  # noqa: E402

DRIVE_ROOT = Path("/Users/udaykanwar/Library/CloudStorage/GoogleDrive-uday.kanwar@lms.org.in/My Drive/SCHOOL RELATED/LMS Central Repository")
SIDECAR = HERE.parent / "drive-index" / "transport_reread.json"
LABEL = {"insurance": "insurance policy / cover note", "fitness": "certificate of fitness", "mv_tax": "motor vehicle (road) tax receipt",
         "pollution": "pollution under control (PUC) certificate", "route_permit": "route permit", "speed_governor": "speed limiting device certificate"}
LO, HI = date(2015, 1, 1), date(2040, 12, 31)
MAX_ATTEMPTS = 3
MAX_PAGES = 4
OUTCOMES_DONE = {"date", "no_expiry", "other_document", "illegible"}

PROMPT = (
    "This is a scan of an Indian vehicle document. The folder says it is a {label} for vehicle {reg}. "
    "Look at every page and answer ONLY with one JSON object, no other text:\n"
    '{{"document_type": "what this document actually is, in a few words (for example: pollution certificate, '
    'fitness refusal letter, speed limiting device fitment certificate, insurance policy, claim form)", '
    '"is_expected_type": true or false, '
    '"issue_date": "YYYY-MM-DD or null", '
    '"valid_until": "YYYY-MM-DD or null", '
    '"validity_quote": "the exact words printed on the document that give the validity or expiry, or null", '
    '"no_expiry_printed": true or false, '
    '"legible": true or false}}\n'
    "Rules: dates on Indian documents are day-month-year (07-03-2027 is 7 March 2027). Fill valid_until ONLY if an expiry or "
    "valid-until date is actually printed; never calculate one, never guess. If the document is the expected kind but prints "
    "no expiry, set valid_until to null and no_expiry_printed to true. If the document has validity fields but they are "
    "blank or unfilled (for example 'Valid ____ To ____'), that also means no expiry is printed: say so in document_type. "
    "If the file is a different kind of document "
    "(a refusal, a claim, an invoice, another certificate), set is_expected_type to false. /no_think"
)


def file_id(link):
    m = re.search(r"/d/([-\w]{20,})", link or "") or re.search(r"[?&]id=([-\w]{20,})", link or "")
    return m[1] if m else ""


def parse_date(s):
    try:
        d = date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None
    return d if LO <= d <= HI else None


def judge(raw, now_year):
    """Turn the model's reply into (outcome, fields). Pure function: the whole trust policy lives here."""
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return "error", {"note": "no JSON in the reply"}
    try:
        j = json.loads(m[0])
    except ValueError:
        return "error", {"note": "reply was not valid JSON"}
    seen = str(j.get("document_type") or "").strip()[:80]
    if j.get("legible") is False:
        return "illegible", {"doc_type_seen": seen, "note": "the model could not read the scan"}
    if j.get("is_expected_type") is False:
        return "other_document", {"doc_type_seen": seen}
    until, issue = parse_date(j.get("valid_until")), parse_date(j.get("issue_date"))
    quote = str(j.get("validity_quote") or "").strip()
    if until:
        # the date only counts if the document's own words carry it: the quote must contain the year (4 digits or the last 2)
        yr = str(until.year)
        if not quote or (yr not in quote and not re.search(r"\b" + yr[2:] + r"\b", quote)):
            return "illegible", {"doc_type_seen": seen, "note": f"model gave {until} but the quoted words do not show it"}
        if issue and until < issue:
            return "illegible", {"doc_type_seen": seen, "note": f"valid-until {until} is before the issue date {issue}"}
        return "date", {"date": until.isoformat(), "issue": issue.isoformat() if issue else "", "doc_type_seen": seen, "quote": quote[:160]}
    if j.get("no_expiry_printed") is True:
        return "no_expiry", {"doc_type_seen": seen, "quote": quote[:160]}
    return "illegible", {"doc_type_seen": seen, "note": "no expiry found and the model did not say none is printed"}


def render_pages(path):
    """Base64 data URLs of the document's pages (PDF: up to MAX_PAGES at 200 dpi; images: as they are)."""
    import lmstudio_summarize as lms
    if path.suffix.lower() == ".pdf":
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(["pdftoppm", "-jpeg", "-f", "1", "-l", str(MAX_PAGES), "-r", "200", str(path), f"{td}/p"], capture_output=True, timeout=120)
            return [lms.img_b64(p) for p in sorted(Path(td).glob("p*.jpg"))]
    return [lms.img_b64(path)]


def reread(path, reg, key):
    import lmstudio_summarize as lms
    pages = render_pages(path)
    if not pages:
        return "error", {"note": "could not render the file"}
    content = [{"type": "text", "text": PROMPT.format(label=LABEL[key], reg=reg)}] + [{"type": "image_url", "image_url": {"url": u}} for u in pages]
    lms.TASK = f"transport re-read: {reg} {key} {path.name}"
    return judge(lms.call(lms.VISION_MODEL, [{"role": "user", "content": content}], max_tokens=500), date.today().year)


def targets():
    """Every Transport scan of the six tracked types with no readable date in records.db."""
    out = []
    q = "select entity, doc_type, relpath, drive_link, valid_to from documents where entity_type='bus'"
    for reg, t, rel, link, vt in sqlite3.connect(DB).execute(q):
        key = DB_TYPES.get(t)
        if not key or key == "rc" or parse_date(vt):
            continue
        fid = file_id(link)
        if fid:
            out.append({"id": fid, "reg": reg, "key": key, "rel": rel, "link": link})
    return out


def load():
    try:
        return json.loads(SIDECAR.read_text())
    except (OSError, ValueError):
        return {}


def selftest():
    ok = lambda r, want: print(("ok   " if r[0] == want else "FAIL ") + f"{want}: {r}") or r[0] == want
    good = '{"document_type":"PUC certificate","is_expected_type":true,"issue_date":"2026-06-15","valid_until":"2027-06-14","validity_quote":"Valid upto 14-06-2027","no_expiry_printed":false,"legible":true}'
    r = [
        ok(judge(good, 2026), "date"),
        ok(judge(good.replace('"validity_quote":"Valid upto 14-06-2027"', '"validity_quote":"valid for one year"'), 2026), "illegible"),  # quote does not carry the year
        ok(judge(good.replace('"valid_until":"2027-06-14"', '"valid_until":"2099-01-01"'), 2026), "illegible"),  # 2099 is out of range, so no date is claimed
        ok(judge(good.replace("2026-06-15", "2028-01-01"), 2026), "illegible"),  # valid-until before issue
        ok(judge('{"document_type":"speed governor fitment","is_expected_type":true,"valid_until":null,"validity_quote":null,"no_expiry_printed":true,"legible":true}', 2026), "no_expiry"),
        ok(judge('{"document_type":"fitness refusal letter","is_expected_type":false,"valid_until":null,"legible":true}', 2026), "other_document"),
        ok(judge('{"legible":false,"document_type":"blur"}', 2026), "illegible"),
        ok(judge('sorry, I cannot', 2026), "error"),
        ok(judge('```json\n' + good + '\n```', 2026), "date"),
    ]
    assert file_id("https://drive.google.com/file/d/1YXpJ7iAHNXj9oxZh6SJDXd8mFI7pUQsb/view") == "1YXpJ7iAHNXj9oxZh6SJDXd8mFI7pUQsb"
    assert file_id("https://drive.google.com/open?id=1lOc3GQF-1WlSHpLUJ7GkKCewKWZ4Qoke") == "1lOc3GQF-1WlSHpLUJ7GkKCewKWZ4Qoke"
    sys.exit(0 if all(r) else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only"); ap.add_argument("--limit", type=int); ap.add_argument("--force", action="store_true"); ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    if not (DRIVE_ROOT / "LMCS Repository").is_dir():
        sys.exit("Google Drive is not mounted; nothing read")
    state, todo = load(), []
    for t in targets():
        p, s = DRIVE_ROOT / t["rel"], state.get(t["id"], {})
        if a.only and t["reg"] != a.only:
            continue
        if not p.exists():
            continue
        mtime = int(p.stat().st_mtime)
        done = s.get("outcome") in OUTCOMES_DONE and s.get("mtime") == mtime
        if (done and not a.force) or (s.get("outcome") == "error" and s.get("attempts", 0) >= MAX_ATTEMPTS and s.get("mtime") == mtime and not a.force):
            continue
        todo.append((t, p, mtime, s))
    todo = todo[:a.limit] if a.limit else todo
    print(f"{len(todo)} scan(s) to re-read")
    for t, p, mtime, s in todo:
        t0 = time.time()
        try:
            outcome, f = reread(p, t["reg"], t["key"])
        except Exception as e:  # LM Studio down or the call timed out: leave it for the next run
            outcome, f = "error", {"note": str(e)[:160]}
        state[t["id"]] = {"reg": t["reg"], "key": t["key"], "file": p.name, "link": t["link"], "outcome": outcome, "mtime": mtime,
                          "attempts": (s.get("attempts", 0) + 1) if outcome == "error" else 0,
                          "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **f}
        SIDECAR.write_text(json.dumps(state, indent=1, sort_keys=True))  # after every file: a stopped run loses nothing
        print(f"  {t['reg']:10} {t['key']:14} {outcome:15} {f.get('date') or f.get('doc_type_seen') or f.get('note') or ''}  ({time.time() - t0:.0f}s)  {p.name}")
    done = [v["outcome"] for v in state.values()]
    print("totals:", {o: done.count(o) for o in sorted(set(done))})


if __name__ == "__main__":
    main()
