package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

tc_ts_project(
    name = "layers",
    deps = [
        "//js/map",
        "//js/map/common",
        "//js/map/rendering",
        "//js/map/workers",
        "//js/server:client",
    ],
)

