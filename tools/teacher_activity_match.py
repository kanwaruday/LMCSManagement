#!/usr/bin/env python3
"""Overnight activity check for the teacher game ("plan, then confirm").

A teacher plans an activity for a chapter in the portal. Each night this script pulls the plans that have class-work notes newer than
the last check from the game backend (action teachermatchpull: opaque plan keys, the planned line, the notes; no names or codes), asks the
local LM Studio whether each note describes that activity, and pushes the verdicts back (teachermatchpush). Quest step 3 ("Run the
activity") reads them. An answer that is not clean JSON is skipped, never guessed.

  python3 tools/teacher_activity_match.py                 # pull, ask, push (needs ~/.lmcs/game_push_secret)
  python3 tools/teacher_activity_match.py --dry-run       # pull and ask, print verdict counts, push nothing
  python3 tools/teacher_activity_match.py --sample 30     # ask about at most 30 notes

The secret is the value of GAME_PUSH_SECRET in the game Apps Script project's Script properties; it is never printed. The backend URL is
the GAME_BACKEND_URL in teacher/plan-activity.html, empty until the game is deployed (then this exits 0 with a message).
Called once a night from the AI Coordinator (ai-coordinator/run.sh).
"""
import argparse, json, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

SECRET_FILE = Path.home() / ".lmcs" / "game_push_secret"
URL_SOURCE = Path(__file__).resolve().parent.parent / "teacher" / "plan-activity.html"  # holds GAME_BACKEND_URL, set at deploy
# Via the lm-monitor proxy (logs + model override + pause); falls back to LM Studio directly if the monitor isn't running (as drive-index/lmstudio_summarize.py).
LMSTUDIO_URL = "http://localhost:1235/v1/chat/completions"
LMSTUDIO_DIRECT = "http://localhost:1234/v1/chat/completions"
MODEL = "qwen3-vl-30b-a3b-instruct"
TOKEN_LOG = Path(__file__).resolve().parent / "private" / "teacher_match_token_usage.jsonl"  # tools/private is git-ignored
# The model's short reason stays on this Mac only (Ruling 30: the workbook gets ''): plan key, entry time, verdict and reason, never the note or the activity.
REASON_LOG = Path(__file__).resolve().parent / "private" / "teacher_match_reasons.jsonl"
PUSH_BATCH = 2000  # the backend's cap per push

PROMPT = ('Planned classroom activity: "{activity}". Teacher\'s note of what happened in class: "{desc}". '
          'Does the note describe doing this activity (or clearly the same activity in other words)? '
          'Answer as JSON {"matched": true|false, "confidence": 0..1, "reason": "<10 words"}. /no_think')


def call(model, messages, max_tokens=80):
    payload = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}).encode()
    headers = {"Content-Type": "application/json", "X-Caller": "teacher-activity-match"}
    try:
        resp = urllib.request.urlopen(urllib.request.Request(LMSTUDIO_URL, data=payload, headers=headers), timeout=180)
    except urllib.error.URLError as e:
        if isinstance(e, urllib.error.HTTPError) or "refused" not in str(e).lower():
            raise
        resp = urllib.request.urlopen(urllib.request.Request(LMSTUDIO_DIRECT, data=payload, headers=headers), timeout=180)
    with resp:
        data = json.load(resp)
    usage = data.get("usage", {})
    try:
        TOKEN_LOG.parent.mkdir(exist_ok=True)
        with open(TOKEN_LOG, "a") as f:
            f.write(json.dumps({"ts": time.time(), "model": model, "prompt_tokens": usage.get("prompt_tokens", 0),
                                "completion_tokens": usage.get("completion_tokens", 0), "total_tokens": usage.get("total_tokens", 0)}) + "\n")
    except Exception:
        pass
    return data["choices"][0]["message"]["content"].strip()


def ask(activity, desc):
    """-> {matched, confidence, reason} or None when the answer is not a clean verdict."""
    prompt = PROMPT.replace("{activity}", activity).replace("{desc}", desc)
    m = re.search(r"\{.*\}", call(MODEL, [{"role": "user", "content": prompt}], max_tokens=80), re.S)
    try:
        v = json.loads(m.group(0))
        matched, conf = v["matched"], v["confidence"]
    except (AttributeError, ValueError, KeyError, TypeError):
        return None
    if not isinstance(matched, bool) or isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0 <= conf <= 1:
        return None
    return {"matched": matched, "confidence": conf, "reason": str(v.get("reason") or "")[:100]}


def log_reason(key, t, v):
    try:
        REASON_LOG.parent.mkdir(exist_ok=True)
        with open(REASON_LOG, "a") as f:
            f.write(json.dumps({"ts": time.time(), "planKey": key, "timeMs": t, "matched": v["matched"], "confidence": v["confidence"], "reason": v["reason"]}) + "\n")
    except Exception:
        pass


def post(url, body):
    """POST JSON to the game backend. curl, not urllib: this Python has no CA certs; -L because Apps Script answers a POST with a redirect to the
    result. The body (and so the secret) goes in on stdin, never on the command line."""
    r = subprocess.run(["curl", "-sSL", "-m", "300", "-H", "Content-Type: text/plain", "--data-binary", "@-", url],
                       input=json.dumps(body), capture_output=True, text=True)
    try:
        res = json.loads(r.stdout)
    except ValueError:
        sys.exit(f"backend did not return JSON (curl exit {r.returncode}): {r.stdout[:200]!r} {r.stderr[:200]}")
    if not res.get("success"):
        sys.exit(f"backend refused {body['action']}: {res.get('error')}")
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="ask, print verdict counts, push nothing")
    ap.add_argument("--sample", type=int, default=0, metavar="N", help="ask about at most N notes")
    args = ap.parse_args(argv)

    url = re.search(r"GAME_BACKEND_URL = '([^']*)'", URL_SOURCE.read_text())[1]
    if not url:
        print("GAME_BACKEND_URL in teacher/plan-activity.html is empty (the game is not deployed yet): nothing to do")
        return 0
    if not SECRET_FILE.exists():
        sys.exit("~/.lmcs/game_push_secret not found; create it with the GAME_PUSH_SECRET value")
    secret = SECRET_FILE.read_text().strip()

    items = post(url, {"action": "teachermatchpull", "secret": secret})["items"]
    asks = [(i["planKey"], i["activity"], e["timeMs"], e["desc"]) for i in items for e in i["entries"]]
    if args.sample:
        asks = asks[:args.sample]
    results, skipped, failed = [], 0, False
    for key, activity, t, desc in asks:
        try:
            v = ask(activity, desc)
        except Exception as e:  # LM Studio down or paused: push what was answered, then report failure
            print(f"LM Studio failed after {len(results) + skipped} of {len(asks)} notes: {type(e).__name__}", file=sys.stderr)
            failed = True
            break
        if v is None:
            skipped += 1
        else:
            log_reason(key, t, v)
            results.append({"planKey": key, "timeMs": t, "matched": v["matched"], "confidence": v["confidence"], "reason": ""})
    hit = sum(r["matched"] for r in results)
    print(f"{len(asks)} notes on {len(items)} plans: matched {hit}, not matched {len(results) - hit}, skipped {skipped} (unparseable)")
    if args.dry_run:
        print("dry run: nothing pushed")
    else:
        for i in range(0, len(results), PUSH_BATCH):
            post(url, {"action": "teachermatchpush", "secret": secret, "results": results[i:i + PUSH_BATCH]})
        print(f"pushed {len(results)} verdicts")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
