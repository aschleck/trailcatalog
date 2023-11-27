package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "location_querier_worker",
    entry_point = "location_querier.ts",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "mbtile_loader_worker",
    entry_point = "mbtile_loader.ts",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "raster_loader_worker",
    entry_point = "raster_loader.ts",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "s2_data_fetcher_worker",
    entry_point = "s2_data_fetcher.ts",
    deps = [
        ":workers",
    ],
)

esbuild_binary(
    name = "xyz_data_fetcher_worker",
    entry_point = "xyz_data_fetcher.ts",
    deps = [
        ":workers",
    ],
)

tc_ts_project(
    name = "workers",
    deps = [
        "//:node_modules/@types/earcut",
        "//:node_modules/earcut",
        "//java/org/trailcatalog/s2",
        "//js/common",
        "//js/map2",
        "//js/map2/common",
        "//js/map2/rendering",
    ],
)

