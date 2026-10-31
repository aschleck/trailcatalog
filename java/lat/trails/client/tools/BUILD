package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "tools",
    deps = [
        "//java/lat/trails/client/data",
        "//java/lat/trails/client/model",
        "//java/lat/trails/client/workers",
        "//java/lat/trails/wire:wire-ts",
        "//java/org/trailcatalog/models:models-ts",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/rendering",
        "//js/map/workers/routing",
        "//js/units",
        "@dev_april_corgi//js/common",
    ],
)
