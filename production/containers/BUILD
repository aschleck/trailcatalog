load("@rules_pkg//pkg:mappings.bzl", "pkg_attributes", "pkg_mkdirs")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load(":defs.bzl", "frontend_image")

# pkg_tar gives implicit parents the child's owner, so we declare them as root's.
pkg_mkdirs(
    name = "nginx_state_parents",
    attributes = pkg_attributes(mode = "0755"),
    dirs = [
        "var",
        "var/lib",
    ],
)

# nginx writes request bodies and proxied responses under here, and nginx-common's postinst, which
# rules_distroless never runs, is what creates it.
pkg_mkdirs(
    name = "nginx_state_dir",
    attributes = pkg_attributes(
        gid = 1000,
        mode = "0755",
        uid = 1000,
    ),
    dirs = ["var/lib/nginx"],
)

pkg_tar(
    name = "nginx_state",
    srcs = [
        ":nginx_state_dir",
        ":nginx_state_parents",
    ],
)

frontend_image(
    name = "lat_trails_frontend",
    nginx_conf = "trails_lat_nginx.conf",
    pkg = "//java/lat/trails:frontend_pkg",
    repository = "lat_trails_frontend",
    runner = "//java/lat/trails/frontend:runner",
)

frontend_image(
    name = "trailcatalog_frontend",
    nginx_conf = "trailcatalog_nginx.conf",
    pkg = "//java/org/trailcatalog:frontend_pkg",
    repository = "frontend",
    runner = "//java/org/trailcatalog/frontend:runner",
)
