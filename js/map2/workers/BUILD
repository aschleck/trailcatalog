package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "raster_loader_worker",
    entry_point = "raster_loader.js",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "s2_data_fetcher_worker",
    entry_point = "s2_data_fetcher.js",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "xyz_data_fetcher_worker",
    entry_point = "xyz_data_fetcher.js",
    deps = [
        ":workers",
    ],
)

tc_ts_project(
    name = "workers",
    deps = [
        "//js/common",
        "//js/map2",
        "//java/org/trailcatalog/s2",
    ],
)

