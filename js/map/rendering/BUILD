package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

tc_ts_project(
    name = "rendering",
    deps = [
        "//:node_modules/@mapbox/tiny-sdf",
        "//:node_modules/grapheme-splitter",
        "//js/common",
        "//js/map/common",
        "//js/server:client",
    ],
)

