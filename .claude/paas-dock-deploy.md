# paas-dock deploy

> ⛔ **STALE — DO NOT USE.** paas-dock is a *different server* and is no longer the deploy
> path for this project. Kept only as historical record. The current deploy target and the
> shared server (frontend + nnf API + be-media) are documented in `.claude/server-and-deploy.md`.
> Read that before logging into any server or deploying.

---


- App name: `frontend-tsp-form`
- URL: https://frontend-tsp-form.ecap.space
- Deploy: `mcp__paas-dock__deploy(app_name="frontend-tsp-form")` from repo root.
- Builds the local Dockerfile (Node 22 alpine → nginx alpine), so `npm run build` must pass first. `tsc -b` is part of the build, so unused vars/imports fail the deploy.
