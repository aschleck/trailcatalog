package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

# TODO(april): geotiff.js has bad dependencies on node modules that break easbuild. So we disable
# sandboxing which somehow helps. Maybe the bazel sandbox plugin tells esbuild the node modules are
# paths?
esbuild_binary(
    name = "earth_search_loader_worker",
    bazel_sandbox_plugin = False,
    entry_point = "earth_search_loader.ts",
    deps = [
        ":workers",
    ],
)

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
    bazel_sandbox_plugin = False,
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
        "//:node_modules/geotiff",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/rendering",
        "@dev_april_corgi//js/common",
    ],
)

