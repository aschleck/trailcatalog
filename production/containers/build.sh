#/bin/bash

set -ex

cd "$(dirname $0)"

bazelisk build \
    //java/lat/trails:frontend_pkg.tar \
    //java/org/trailcatalog:frontend_pkg.tar

gcloud auth print-access-token | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev

cp --no-preserve=mode ../../bazel-bin/java/lat/trails/frontend_pkg.tar .
TMPDIR=/tmp buildah bud \
    -f Containerfile \
    --build-arg 'NGINX_CONF=trails_lat_nginx.conf' \
    --layers \
    --tag localhost/lat/trails/frontend:latest
podman push localhost/lat/trails/frontend:latest us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_frontend:latest

cp --no-preserve=mode ../../bazel-bin/java/org/trailcatalog/frontend_pkg.tar .
TMPDIR=/tmp buildah bud \
    -f Containerfile \
    --build-arg 'NGINX_CONF=trailcatalog_nginx.conf' \
    --layers \
    --tag localhost/org/trailcatalog/frontend:latest
podman push localhost/org/trailcatalog/frontend:latest us-west1-docker.pkg.dev/trailcatalog/containers/frontend:latest
