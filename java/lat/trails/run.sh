set -e
cd $(dirname "$0")
cd ../../../
bazelisk build \
    java/lat/trails:api_server \
    java/lat/trails/frontend:runner \
    java/lat/trails:static
nginx \
    -c "$(pwd)/java/lat/trails/nginx.conf" \
    -e /dev/stderr \
    -p "$(pwd)" &
trap 'kill $(jobs -p)' EXIT

# socat stands in for the systemd socket in configuration.nix, without its sandbox. -t is how long
# it waits for the encoder's answer after the upload finishes, which is 0.5 seconds by default.
encoder_socket="$(mktemp -d)/encoder.sock"
nix-shell -p exiftool socat vips --run "socat -t 30 UNIX-LISTEN:${encoder_socket},fork \
    EXEC:production/files/trails_lat_image_encoder.sh" &

# See frontend/oidc.ts#LoginConfig.
LOGIN_PROVIDERS='{
  "google": {
    "client_id": "347014216307-7u1hp5dkr05p62q0r75b76rau37c6o9j.apps.googleusercontent.com",
    "client_secret": "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"
  }
}'

BAZEL_BINDIR="." \
    COOKIE_SECRET=" fjqip210  ! 34 12pfds*()! f ADFFSD fjko1~4!" \
    DEBUG=true \
    LOGIN_PROVIDERS="${LOGIN_PROVIDERS}" \
    PGHOST="127.0.0.1" \
    PGPORT="5432" \
    PGUSER="trails_lat" \
    PGPASSWORD="trails_lat" \
    PGDATABASE="trails_lat" \
    ./bazel-bin/java/lat/trails/frontend/runner_/runner &

 DEFAULT_JVM_DEBUG_SUSPEND=n \
    ./bazel-bin/java/lat/trails/api_server \
    --debug=0.0.0.0:5005 \
    --image_directory="${HOME}/trails_lat_images" \
    --image_encoder_socket="${encoder_socket}" \
    --database_username_password="trails_lat:trails_lat" \
    --database_url="postgresql://127.0.0.1:5432/trails_lat" \
    --trailcatalog_database_username_password="trailcatalog:trailcatalog" \
    --trailcatalog_database_url="postgresql://127.0.0.1:5432/trailcatalog"

