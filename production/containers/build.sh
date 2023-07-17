#/bin/bash

set -ex

cd "$(dirname $0)"
bazelisk build '//production/containers:frontend_pkg.tar'
cp --no-preserve=mode \
    ../../bazel-bin/production/containers/frontend_pkg.tar \
    .
buildah bud -f Containerfile --layers --tag localhost/bazel/production/containers/frontend:latest
gcloud auth print-access-token | podman login -u oauth2accesstoken --password-stdin us-west1-docker.pkg.dev
podman push localhost/bazel/production/containers/frontend:latest us-west1-docker.pkg.dev/trailcatalog/containers/frontend:latest
