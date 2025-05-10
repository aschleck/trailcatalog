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
    css_deps = [
        "//js/dino:css",
    ],
    deps = [
        "//java/org/trailcatalog/client/data",
        "//java/org/trailcatalog/client/map",
        "//js/dino",
        "//js/map",
        "//js/map/layers",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/server:client",
    ],
)

