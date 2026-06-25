# Server & Deploy — read before SSH or deploy

One shared server hosts the frontend, the nnf API, and be-media. **paas-dock is a
different, unused server** — ignore `.claude/paas-dock-deploy.md` (kept only as history).

## The server

- Host: `nnfsup@103.208.24.76` (Traefik + Let's Encrypt, all containers on the
  `traefik-net` Docker network).
- SSH: `ssh nnfsup@103.208.24.76` (key-based; `just ssh` opens a shell).
- Same box as the nnf backend repo (`D:\dev\nnf`).

## This frontend

- Deploy: `just direct-deploy` from this repo root (builds the Dockerfile locally,
  `docker save`/`scp`/`docker load`/`docker run` on the server). `npm run build`
  must pass first — `tsc -b` runs inside the image build.
- Container: `nnf-ui` · URL: https://nnfui.czynet.dev
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
