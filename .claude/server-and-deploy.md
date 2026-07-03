# Server & Deploy — read before SSH or deploy

One shared server hosts the frontend, the nnf API, and be-media. **paas-dock is a
different, unused server** — ignore `.claude/paas-dock-deploy.md` (kept only as history).

## The server

- Host: `nnfsup@103.208.24.76` (Traefik + Let's Encrypt, all containers on the
  `traefik-net` Docker network).
- SSH: `ssh nnfsup@103.208.24.76` (key-based; `just ssh` opens a shell).
- Same box as the nnf backend repo (`D:\dev\nnf`).

## This frontend

- **Deploy: `just deploy`** from this repo root. Builds locally (`npm run build`)
  and tar-ships **only `dist/`** over ssh into `/home/nnfsup/nnf-ui-dist`. No image
  transfer, no container restart — nginx serves the new files immediately. Seconds,
  not minutes.
- **Gotcha (this Windows box):** `just` runs recipes under Git Bash, which can't
  resolve `npm` (`/bin/bash: .../npm: No such file or directory`, exit 127) — so
  `just deploy` dies at its `build` step. Work around it by running the two halves
  in their own shells: **build in PowerShell** (`npm run build`), then **ship in
  Bash** (the `ssh rm -rf …` + `tar -C dist -czf - . | ssh … "tar -C /home/nnfsup/nnf-ui-dist -xzf -"`
  from the `deploy` recipe). Same result as the recipe. Don't "fix" the justfile
  without being asked.
- **Why it works:** the `nnf-ui` container is a **persistent `nginx:alpine`** that
  mounts `/home/nnfsup/nnf-ui-dist` (html) + `/home/nnfsup/nnf-ui-conf/default.conf`.
  `just deploy` only swaps files in the mounted dir. **If that container is ever
  missing, `deploy` copies into a dir nothing serves (silent no-op)** — recreate it
  with `just serve`.
- **Edited `nginx.conf`? Run `just serve`, not `just deploy`** — `serve` re-pushes
  the conf and recreates the container. `deploy` never touches nginx config.
- Container: `nnf-ui` · URL: https://nnfui.czynet.dev
- Windows has no rsync, so the ship is tar-of-whole-`dist/` (~a few MB gzipped), not
  file-delta. Fine at this size; don't "optimize" it into a broken rsync call.
- Fallback: `just deploy-image` is the old full-image build+scp path (slow), kept in
  case the static setup ever needs replacing.
- Other just recipes: `just status`, `just logs` (tails `nnf-ui`), `just restart`,
  `just ssh`. All target the same host via the vars at the top of `justfile`.

## Containers on this server (names you'll actually use)

| Container        | What it is                          | URL / note                     |
|------------------|-------------------------------------|--------------------------------|
| `nnf-ui`         | this frontend                       | nnfui.czynet.dev               |
| `nnf-be-media`   | be-media (PDF render + media broker)| be-media.czynet.dev            |
| `nnf-misc-go`    | misc-go upload service              | misc.ecap.cc                   |
| `nnf-worker`, `nnf-cron-sweeper`, `nnf-consumer-runner`, `nnf-ws`, … | nnf backend workers | — |

(Full list: `ssh nnfsup@103.208.24.76 "docker ps --format '{{.Names}}\t{{.Image}}'"`.)

## Reading be-media logs (e.g. RENDER_FAILED debugging)

be-media's `/contract/pdf` returns a generic `{code:"RENDER_FAILED"}` 500; the real
cause is **server-side only**. Pull it:

```sh
ssh nnfsup@103.208.24.76 "docker logs --tail 80 nnf-be-media 2>&1 | grep -iE 'render|pdf|error'"
```

The renderer logs `contract pdf: render failed (contract=NNN): <real error>`.
`chromedp render: page load error net::ERR_ABORTED` = the HTML handed to headless
Chromium failed to load (malformed `data:text/html` URL or a sub-resource that
aborted) — a be-media bug, not a frontend request problem.
