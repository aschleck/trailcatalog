package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

tc_ts_project(
    name = "rendering",
    deps = [
        "//:node_modules/@mapbox/tiny-sdf",
        "//:node_modules/@types/node",
        "//:node_modules/grapheme-splitter",
        "//js/map/common",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/server:client",
    ],
)

