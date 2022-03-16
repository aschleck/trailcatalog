set -e
cd $(dirname "$0")
cd ../../../
bazel build java/org/trailcatalog:frontend
/usr/sbin/nginx -p "$(pwd)" -c "java/org/trailcatalog/nginx.conf" &
trap 'kill $(jobs -p)' EXIT
DEFAULT_JVM_DEBUG_SUSPEND=n ./bazel-bin/java/org/trailcatalog/frontend --debug=0.0.0.0:5005
