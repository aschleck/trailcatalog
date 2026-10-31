package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "layers",
    deps = [
        "//java/lat/trails/client/data",
        "//java/lat/trails/client/model",
        "//java/lat/trails/client/sky",
        "//java/lat/trails/client/tools",
        "//java/lat/trails/client/ui",
        "//java/lat/trails/client/workers",
        "//java/lat/trails/wire:wire-ts",
        "//java/org/trailcatalog/client/points",
        "//java/org/trailcatalog/models:models-ts",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/layers",
        "//js/map/rendering",
        "//js/map/workers",
        "//js/map/workers/elevation",
        "//js/map/workers/raster",
        "//js/map/workers/routing",
        "//js/map/workers/s2",
        "//js/map/workers/tiles",
        "//js/units",
        "@dev_april_corgi//js/common",
    ],
)
