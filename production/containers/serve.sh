#!/bin/bash

set -ex

nginx -c '/app/nginx.conf' -e '/dev/stderr' &
node '/app/frontend.js' &
java -jar '/app/api_server_deploy.jar' &

# Wait for the first process to exit
wait -n
exit $?

