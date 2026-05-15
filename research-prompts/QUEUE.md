# Research Queue — Lucky's Night Tasks

Status convention: `[ ]` pending · `[~]` in-progress · `[x]` done · `[!]` blocked

## Tasks

- [ ] **#1 Landing Page Builder** → see `01-landing-page-builder.md` · output to `/home/wabot/research-results/landing-builder-{date}.md`
- [ ] **#2 Social Media Tool + Guide** → see `02-social-media-tool.md` · output to `/home/wabot/research-results/social-media-2026-05-15.md`

## Working agreements (for the loop)

1. Read this QUEUE.md, pick the first `[ ]` task
2. Update to `[~]` (in-progress) before working
3. Read the linked prompt file fully
4. Execute (use WebSearch, WebFetch, Bash for installs, etc.)
5. Save output to the designated result file
6. Send 1 ringkasan WA ke `6282218255795` via Evolution endpoint
7. Update to `[x]` (done) with timestamp
8. If queue still has `[ ]` items, ScheduleWakeup ~600s for next
9. If queue empty, STOP (do not schedule)
10. If task blocked (missing tool/auth), mark `[!]` with reason, move to next task

## Constraints

- VPS shared dengan production vinfast-bot — jangan touch port 80/443/3000/3001/5432/5433/6379/6380/8080
- WebSearch token budget: max 5 searches per task
- WebFetch: max 8 pages per task
- Implementation POC: stop container setelah verifikasi (jangan biarkan jalan terus)
- Result file in markdown, jangan output emoji berlebihan, struktur dengan H2/H3 + tabel
