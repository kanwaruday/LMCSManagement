#!/usr/bin/env python3
"""python3 -I tools/test_teacher_activity_match.py  -- assert-based; LM Studio and curl are stubbed, nothing leaves this machine."""
import contextlib, io, json, sys, tempfile, urllib.error
from pathlib import Path
from types import SimpleNamespace

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import teacher_activity_match as tam
real_call = tam.call

tmp = Path(tempfile.mkdtemp())
SECRET = "unit-test-secret-xyz"
(tmp / "secret").write_text(SECRET + "\n")
(tmp / "page.html").write_text("const GAME_BACKEND_URL = 'https://script.example.test/exec'; // set at deploy\n")
tam.SECRET_FILE, tam.URL_SOURCE, tam.TOKEN_LOG = tmp / "secret", tmp / "page.html", tmp / "tokens.jsonl"

# ---- ask(): the prompt, and only a clean verdict comes back
seen = []
def fake_call(answer):
    def f(model, messages, max_tokens=80):
        seen.append((model, messages[0]["content"], max_tokens)); return answer
    return f

tam.call = fake_call('{"matched": true, "confidence": 0.85, "reason": "same pizza fractions"}')
v = tam.ask("Pizza slices", "Cut paper pizzas")
assert v == {"matched": True, "confidence": 0.85, "reason": "same pizza fractions"}, v
model, prompt, mx = seen[-1]
assert model == "qwen3-vl-30b-a3b-instruct" and mx == 80
assert prompt == ('Planned classroom activity: "Pizza slices". Teacher\'s note of what happened in class: "Cut paper pizzas". '
                  'Does the note describe doing this activity (or clearly the same activity in other words)? '
                  'Answer as JSON {"matched": true|false, "confidence": 0..1, "reason": "<10 words"}. /no_think'), prompt
for bad in ["", "sure!", "{matched: true", '{"matched": "yes", "confidence": 0.9}', '{"matched": true}', '{"matched": true, "confidence": 1.4}',
            '{"matched": false, "confidence": -0.2}', '{"matched": true, "confidence": "high"}', '[1, 2]', '{"matched": null, "confidence": 0.5}']:
    tam.call = fake_call(bad)
    assert tam.ask("a", "b") is None, bad
tam.call = fake_call('```json\n{"matched": false, "confidence": 0, "reason": "' + "long " * 40 + '"}\n```')
v = tam.ask("a", "b")
assert v["matched"] is False and v["confidence"] == 0 and len(v["reason"]) <= 100, v

# ---- call(): proxy first, direct on a refused connection; X-Caller header; token log
class Resp:
    def __init__(self, body): self.body = body
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self, *a): return json.dumps(self.body).encode()
urls = []
def fake_urlopen(req, timeout=0):
    urls.append((req.full_url, req.get_header("X-caller")))
    if ":1235" in req.full_url: raise urllib.error.URLError("[Errno 61] Connection refused")
    return Resp({"choices": [{"message": {"content": " hi "}}], "usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}})
tam.urllib.request.urlopen = fake_urlopen
assert real_call("m", [{"role": "user", "content": "x"}]) == "hi"
assert [u for u, _ in urls] == ["http://localhost:1235/v1/chat/completions", "http://localhost:1234/v1/chat/completions"] and urls[0][1] == "teacher-activity-match", urls
assert json.loads(tam.TOKEN_LOG.read_text().splitlines()[-1])["total_tokens"] == 10

# ---- main(): curl is stubbed; the first POST is the pull, the second the push
PULL = {"success": True, "items": [
    {"planKey": "k1", "activity": "Pizza slices", "entries": [{"timeMs": 100, "desc": "cut pizzas"}, {"timeMs": 200, "desc": "quiz"}]},
    {"planKey": "k2", "activity": "Onion slide", "entries": [{"timeMs": 300, "desc": "looked at cells"}]}]}
sent, answers = [], {"cut pizzas": '{"matched": true, "confidence": 0.9, "reason": "pizza fractions"}', "quiz": "rambling, no json",
                     "looked at cells": '{"matched": false, "confidence": 0.3, "reason": "no slide"}'}
def fake_run(argv, input=None, capture_output=None, text=None, **kw):
    assert argv[0] == "curl" and "-sSL" in argv, argv
    assert SECRET not in " ".join(argv), "the secret must not be on the command line"
    body = json.loads(input); sent.append(body)
    out = PULL if body["action"] == "teachermatchpull" else {"success": True, "written": len(body["results"])}
    return SimpleNamespace(returncode=0, stdout=json.dumps(out), stderr="")
tam.subprocess.run = fake_run
def run(*argv):
    sent.clear(); out = io.StringIO()
    tam.call = lambda model, messages, max_tokens=80: answers[messages[0]["content"].split("what happened in class: \"")[1].split("\". Does")[0]]
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        rc = tam.main(list(argv))
    text = out.getvalue()
    assert SECRET not in text, "the secret must never be printed"
    return rc, text

rc, text = run()
assert rc == 0 and [b["action"] for b in sent] == ["teachermatchpull", "teachermatchpush"], sent
assert all(b["secret"] == SECRET for b in sent)
assert sent[1]["results"] == [  # the malformed answer was skipped, not guessed
    {"planKey": "k1", "timeMs": 100, "matched": True, "confidence": 0.9, "reason": "pizza fractions"},
    {"planKey": "k2", "timeMs": 300, "matched": False, "confidence": 0.3, "reason": "no slide"}], sent[1]
assert "skipped 1" in text

rc, text = run("--dry-run")  # asks, prints counts, sends no push
assert rc == 0 and [b["action"] for b in sent] == ["teachermatchpull"], sent
assert "matched 1" in text and "not matched 1" in text and "skipped 1" in text and "dry run" in text.lower(), text

rc, text = run("--sample", "1")  # limits the entries asked, in pull order
assert rc == 0 and len(sent[1]["results"]) == 1 and sent[1]["results"][0]["planKey"] == "k1"

# nothing to push: no push call at all
PULL_SAVED = PULL; PULL = {"success": True, "items": []}
rc, text = run(); assert rc == 0 and [b["action"] for b in sent] == ["teachermatchpull"]; PULL = PULL_SAVED

# a refused pull / push is a non-zero exit with the backend's words
def refusing(argv, input=None, **kw): return SimpleNamespace(returncode=0, stdout=json.dumps({"success": False, "error": "Not authorized"}), stderr="")
tam.subprocess.run = refusing
try: run(); raise SystemExit("expected a non-zero exit")
except SystemExit as e: assert "Not authorized" in str(e.code), e.code
tam.subprocess.run = fake_run

# LM Studio failing part-way: what was answered is still pushed, and the run reports failure (no stamp in run.sh)
def flaky(model, messages, max_tokens=80):
    if "quiz" in messages[0]["content"]: raise urllib.error.URLError("down")
    return answers["cut pizzas"]
sent.clear(); tam.call = flaky
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()): rc = tam.main([])
assert rc != 0 and [b["action"] for b in sent] == ["teachermatchpull", "teachermatchpush"] and len(sent[1]["results"]) == 1

# ---- the deployment URL is empty until deploy: a clear message, exit 0, nothing sent; a missing secret stops before any request
(tmp / "page.html").write_text("const GAME_BACKEND_URL = ''; // set at deploy\n")
rc, text = run(); assert rc == 0 and sent == [] and "GAME_BACKEND_URL" in text, text
(tmp / "page.html").write_text("const GAME_BACKEND_URL = 'https://script.example.test/exec';\n")
(tmp / "secret").unlink()
try: run(); raise SystemExit("expected a non-zero exit")
except SystemExit as e: assert "game_push_secret" in str(e.code) and sent == [], e.code
print("ok teacher activity match (python)")
