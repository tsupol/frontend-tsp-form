droplet_ip := "103.208.24.76"
droplet_user := "nnfsup"
image_name := "nnf-ui"
container_name := "nnf-ui"
remote_dir := "/home/nnfsup/nnf-ui"
container_port := "80"
host_rule := "nnfui.czynet.dev"

docker-build:
    docker build -t {{image_name}} .

direct-deploy: docker-build
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
            {{image_name}} \
    "

restart:
    ssh {{droplet_user}}@{{droplet_ip}} " \
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
            {{image_name}} \
    "

status:
    ssh {{droplet_user}}@{{droplet_ip}} "docker ps -f name={{container_name}}"

logs:
    ssh {{droplet_user}}@{{droplet_ip}} "docker logs -f {{container_name}}"

ssh:
    ssh {{droplet_user}}@{{droplet_ip}}
