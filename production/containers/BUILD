load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

pkg_tar(
    name = "frontend_pkg",
    package_dir = "app",
    srcs = [
        "//java/org/trailcatalog/frontend:frontend.js",
        "//java/org/trailcatalog/frontend:frontend.js.map",
        "//java/org/trailcatalog:api_server_deploy.jar",
        "//js/s2viewer:s2_pkg",
        ":static_data",
    ],
    stamp = 1,
)

pkg_files(
    name = "static_data",
    srcs = [
        "//java/org/trailcatalog/static",
    ],
    prefix = "static",
    strip_prefix = strip_prefix.from_pkg(),
)

