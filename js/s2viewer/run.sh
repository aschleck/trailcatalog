set -e
cd $(dirname "$0")
cd ../../
bazel build //js/s2viewer:s2_pkg
nginx \
    -c "$(pwd)/js/s2viewer/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT
ibazel build //js/s2viewer
