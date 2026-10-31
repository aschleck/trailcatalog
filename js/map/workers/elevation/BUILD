package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "elevation",
    deps = [
        "//java/org/trailcatalog/s2",
        "//js/map/common",
        "//js/map/workers",
        "//js/map/workers/raster",
        "@dev_april_corgi//js/common",
    ],
)
