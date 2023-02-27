set -e
cd $(dirname "$0")
cd ../../../../
bazel build //java/org/trailcatalog/s2client //java/org/trailcatalog/s2client:workers
/usr/sbin/nginx \
    -c "$(pwd)/java/org/trailcatalog/s2client/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT
ibazel build //java/org/trailcatalog/s2client
