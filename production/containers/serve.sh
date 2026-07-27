#!/bin/bash

set -ex

nginx -c '/app/nginx.conf' -e '/dev/stderr' &
nginx_pid="$!"
${NODEJS_DIR}/bin/node --enable-source-maps '/app/frontend.js' &
node_pid="$!"
java -jar '/app/api_server_deploy.jar' "$@" &
fe_pid="$!"

# Pid 1 doesn't get signals with a default disposition, so without this podman never stops us.
trap 'kill "${nginx_pid}" "${node_pid}" "${fe_pid}" 2>/dev/null || true' TERM

# Wait for the first process to exit
wait -n "${nginx_pid}" "${node_pid}" "${fe_pid}"
exit_code="$?"
kill "${nginx_pid}" "${node_pid}" "${fe_pid}" 2>/dev/null || true
exit "${exit_code}"

