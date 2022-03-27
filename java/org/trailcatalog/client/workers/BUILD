package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "data_fetcher_worker",
    entry_point = "data_fetcher.ts",
    deps = [
        ":ts",
    ],
)

esbuild_binary(
    name = "tile_fetcher_worker",
    entry_point = "tile_fetcher.ts",
    deps = [
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    deps = [
        "//java/org/trailcatalog/client/common",
        "//java/org/trailcatalog/s2",
    ],
)
