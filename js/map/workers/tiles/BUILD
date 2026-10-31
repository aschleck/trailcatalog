package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "tiles",
    deps = [
        "//:node_modules/@types/earcut",
        "//:node_modules/earcut",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/rendering",
        "//js/map/workers",
        "@dev_april_corgi//js/common",
    ],
)
