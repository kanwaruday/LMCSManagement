# LM Studio

This project has an established local LM Studio pipeline — check it's running (`curl -s http://localhost:1234/v1/models`) and use it for bulk/repetitive document or text analysis rather than doing that work directly.

- API: `http://localhost:1234/v1/chat/completions`, OpenAI-compatible.
- Model in use throughout this project: `qwen3-vl-30b-a3b-instruct` (handles both vision and text — no need to juggle separate models).
- Reference implementation: [drive-index/lmstudio_summarize.py](drive-index/lmstudio_summarize.py) — image description, PDF text extraction (falls back to rendering + vision for scanned PDFs), .docx/.xlsx extraction, structured "Key data: / Summary:" prompt format, `/no_think` suffix on text-model prompts (Qwen3 leaks `<think>` reasoning tokens otherwise and truncates before the real answer).
- Token usage is logged to `drive-index/lmstudio_token_usage.jsonl` on every call; check totals with `python3 drive-index/token_usage_report.py`. This is separate from and doesn't count against Claude usage — it's free local compute.

# Working agreement (set up 2026-10-21)

- **Verify before handing back.** After any change run `node tests/verify.mjs` (tests, .gs compile, project mapping). After a deploy run `node tests/verify.mjs --live` and, for UI changes, load the live page in the browser pane and check the console for errors. Report what you checked; don't ask Uday to confirm "is it live".
- **Apps Script deploys go through clasp**, never copy-paste: `node apps-script/deploy.mjs <project>` is a dry run, `--push --deploy "msg"` ships it and keeps the live /exec URL. Projects and file lists: `apps-script/projects.json`. A new `.gs` file must be added there (`verify.mjs` fails if it isn't).
- **Commit and push** once verify passes, without asking again, when Uday has asked for the change to be shipped.
- Briefs from Uday are outcomes with a done-when; do the whole thing, then report. Ask only when blocked.
