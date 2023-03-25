package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "tile_fetcher_worker",
    entry_point = "tile_fetcher.ts",
    deps = [
        ":workers",
    ],
)

tc_ts_project(
    name = "workers",
    deps = [
        "//js/common",
        "//js/map/common",
        "//java/org/trailcatalog/s2",
    ],
)
