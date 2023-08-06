set -e
cd $(dirname "$0")
cd ../../../
#bazelisk build java/org/trailcatalog:api_server java/org/trailcatalog/frontend:runner
bazelisk build \
    java/lat/trails/frontend:runner \
    java/lat/trails/static
ibazel build \
    java/lat/trails/frontend:runner \
    java/lat/trails/static \
    &
nginx \
    -c "$(pwd)/java/lat/trails/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT

BAZEL_BINDIR="." \
    COOKIE_SECRET=" fjqip210  ! 34 12pfds*()! f ADFFSD fjko1~4!" \
    DEBUG=true \
    PGHOST="127.0.0.1" \
    PGPORT="5432" \
    PGUSER="trails_lat" \
    PGPASSWORD="trails_lat" \
    PGDATABASE="trails_lat" \
    OAUTH2_GOOGLE_CLIENT_ID="347014216307-7u1hp5dkr05p62q0r75b76rau37c6o9j.apps.googleusercontent.com" \
    OAUTH2_GOOGLE_SECRET="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" \
    ./bazel-bin/java/lat/trails/frontend/runner.sh
# DATABASE_USERNAME_PASSWORD="trails_lat:trails_lat" \
#    DATABASE_URL="postgresql://127.0.0.1:5432/trails_lat?currentSchema=migration_1_data" \
#DATABASE_URL="postgresql://127.0.0.1:5432/trailcatalog?currentSchema=migration_3_faster" \
#    DATABASE_USERNAME_PASSWORD="trailcatalog:trailcatalog" \
#    DEFAULT_JVM_DEBUG_SUSPEND=n \
#    ./bazel-bin/java/org/trailcatalog/api_server --debug=0.0.0.0:5005
