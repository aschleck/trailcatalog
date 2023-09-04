package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "collection_loader_worker",
    entry_point = "collection_loader.js",
    deps = [
        ":workers",
    ],
)

tc_ts_project(
    name = "workers",
    deps = [
        "//:node_modules/@types/earcut",
        "//:node_modules/earcut",
        "//js/common",
        "//js/map2",
        "//js/map2/common",
        "//java/org/trailcatalog/s2",
    ],
)

