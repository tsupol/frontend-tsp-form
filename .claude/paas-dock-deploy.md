# paas-dock deploy

- App name: `frontend-tsp-form`
- URL: https://frontend-tsp-form.ecap.space
- Deploy: `mcp__paas-dock__deploy(app_name="frontend-tsp-form")` from repo root.
- Builds the local Dockerfile (Node 22 alpine → nginx alpine), so `npm run build` must pass first. `tsc -b` is part of the build, so unused vars/imports fail the deploy.
