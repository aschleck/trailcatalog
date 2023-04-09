set -e
cd $(dirname "$0")
cd ../../../
bazel build java/org/trailcatalog:api_server java/org/trailcatalog/frontend:runner
nginx \
    -c "$(pwd)/java/org/trailcatalog/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT
BAZEL_BINDIR="." DEBUG=true ./bazel-bin/java/org/trailcatalog/frontend/runner.sh &
DATABASE_URL="postgresql://127.0.0.1:5432/trailcatalog?currentSchema=migration_3_faster" \
    DATABASE_USERNAME_PASSWORD="trailcatalog:trailcatalog" \
    DEFAULT_JVM_DEBUG_SUSPEND=n \
    ./bazel-bin/java/org/trailcatalog/api_server --debug=0.0.0.0:5005
