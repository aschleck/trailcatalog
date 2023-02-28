set -e
cd $(dirname "$0")
cd ../../../../
bazel build //java/org/trailcatalog/s2viewer //java/org/trailcatalog/s2viewer:workers
/usr/sbin/nginx \
    -c "$(pwd)/java/org/trailcatalog/s2viewer/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT
ibazel build //java/org/trailcatalog/s2viewer
