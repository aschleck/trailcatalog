package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "raster",
    deps = [
        "//:node_modules/geotiff",
        "//java/lat/trails/wire:wire-ts",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/rendering",
        "//js/map/workers",
        "@dev_april_corgi//js/common",
    ],
)
