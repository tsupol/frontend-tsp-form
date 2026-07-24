# Use bash so recipes resolve npm/node the same way on Windows (Git Bash) and
# Unix. Default `sh` on Windows mangles the nodejs path and breaks `build`.
set shell := ["bash", "-cu"]

droplet_ip := "103.208.24.76"
droplet_user := "nnfsup"
image_name := "nnf-ui"
container_name := "nnf-ui"
remote_dir := "/home/nnfsup/nnf-ui"
dist_dir := "/home/nnfsup/nnf-ui-dist"
conf_dir := "/home/nnfsup/nnf-ui-conf"
container_port := "80"
host_rule := "nnfui.czynet.dev"

# ── Static deploy (default) ─────────────────────────────────────────────────
# Build locally, ship only the dist/ over ssh (tar+gzip stream). The server runs
# a persistent nginx:alpine that mounts {{dist_dir}} as its html root, so there is
# NO image transfer and NO container restart — nginx serves the new files at once.
# A few MB on the wire vs the whole image; deploys take seconds.
#
# tar --delete of the remote dir before extract clears removed/renamed bundles
# (hashed filenames would otherwise accumulate). index.html is uncached (nginx.conf).
deploy: build
    ssh {{droplet_user}}@{{droplet_ip}} "rm -rf {{dist_dir}}/* {{dist_dir}}/.[!.]*" 2>/dev/null || true
    tar -C dist -czf - . | ssh {{droplet_user}}@{{droplet_ip}} "tar -C {{dist_dir}} -xzf -"
    @echo "Deployed to https://{{host_rule}}"

build:
    npm run build

# ── One-time / recovery: (re)create the persistent nginx container ──────────
# Serves {{dist_dir}} with {{conf_dir}}/default.conf, wired to Traefik. Run after
# editing nginx.conf (push it first: scp nginx.conf …:{{conf_dir}}/default.conf).
serve:
    scp nginx.conf {{droplet_user}}@{{droplet_ip}}:{{conf_dir}}/default.conf
    ssh {{droplet_user}}@{{droplet_ip}} " \
        mkdir -p {{dist_dir}} {{conf_dir}} && \
        docker stop {{container_name}} 2>/dev/null; \
        docker rm {{container_name}} 2>/dev/null; \
        docker run -d \
            --name {{container_name}} \
            --restart unless-stopped \
            --network traefik-net \
            -v {{dist_dir}}:/usr/share/nginx/html:ro \
            -v {{conf_dir}}/default.conf:/etc/nginx/conf.d/default.conf:ro \
            --label traefik.enable=true \
            --label 'traefik.http.routers.nnfui.rule=Host(\`{{host_rule}}\`)' \
            --label traefik.http.routers.nnfui.entrypoints=websecure \
            --label traefik.http.routers.nnfui.tls.certresolver=letsencrypt \
            --label traefik.http.services.nnfui.loadbalancer.server.port={{container_port}} \
            nginx:alpine \
    "

restart:
    ssh {{droplet_user}}@{{droplet_ip}} "docker restart {{container_name}}"

status:
    ssh {{droplet_user}}@{{droplet_ip}} "docker ps -f name={{container_name}}"

logs:
    ssh {{droplet_user}}@{{droplet_ip}} "docker logs -f {{container_name}}"

ssh:
    ssh {{droplet_user}}@{{droplet_ip}}

# ── Legacy: full-image deploy (slow; kept as fallback) ──────────────────────
docker-build:
    docker build -t {{image_name}} .

deploy-image: docker-build
    docker save {{image_name}} | gzip > {{image_name}}.tar.gz
    ssh {{droplet_user}}@{{droplet_ip}} "mkdir -p {{remote_dir}}"
    scp {{image_name}}.tar.gz {{droplet_user}}@{{droplet_ip}}:{{remote_dir}}/
    ssh {{droplet_user}}@{{droplet_ip}} " \
        docker load < {{remote_dir}}/{{image_name}}.tar.gz && \
        docker stop {{container_name}} 2>/dev/null; \
        docker rm {{container_name}} 2>/dev/null; \
        docker run -d \
            --name {{container_name}} \
            --restart unless-stopped \
            --network traefik-net \
            --label traefik.enable=true \
            --label 'traefik.http.routers.nnfui.rule=Host(\`{{host_rule}}\`)' \
            --label traefik.http.routers.nnfui.entrypoints=websecure \
            --label traefik.http.routers.nnfui.tls.certresolver=letsencrypt \
            --label traefik.http.services.nnfui.loadbalancer.server.port={{container_port}} \
            {{image_name}} && \
        rm -f {{remote_dir}}/{{image_name}}.tar.gz && \
        docker image prune -f \
    "
    rm -f {{image_name}}.tar.gz
    docker image prune -f
