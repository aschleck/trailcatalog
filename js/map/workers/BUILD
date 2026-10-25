package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "tc_ts_project")

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

