package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

tc_ts_project(
    name = "map",
    deps = [
        "//java/org/trailcatalog/s2",
        "//js/corgi",
        "//js/emu",
        "//js/map/common",
        "//js/map/rendering",
    ],
)

