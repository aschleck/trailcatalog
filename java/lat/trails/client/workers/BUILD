package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "workers",
    deps = [
        "//:node_modules/@types/earcut",
        "//:node_modules/earcut",
        "//js/map",
        "//js/map/common",
        "//js/map/workers",
        "//java/lat/trails/wire:wire-ts",
        "//java/org/trailcatalog/models:models-ts",
        "//java/org/trailcatalog/s2",
        "@dev_april_corgi//js/common",
    ],
)

