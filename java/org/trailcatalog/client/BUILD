package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "client",
    entry_point = "app.js",
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    data = [
        "//java/org/trailcatalog:assets",
    ],
    css_deps = [
        "//js/dino:css",
    ],
    deps = [
        "//java/org/trailcatalog/client/data",
        "//java/org/trailcatalog/client/map",
        "//java/org/trailcatalog/client/views",
        "//js/common",
        "//js/corgi",
        "//js/dino",
        "//js/map",
    ],
)

