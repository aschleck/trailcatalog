package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

tc_ts_project(
    name = "layers",
    deps = [
        "//js/map2",
        "//js/map2/common",
        "//js/map2/rendering",
        "//js/map2/workers",
        "//js/server:client",
    ],
)

