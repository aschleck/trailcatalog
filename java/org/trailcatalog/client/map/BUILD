package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "map",
    deps = [
        "//java/org/trailcatalog/client/common",
        "//java/org/trailcatalog/client/data",
        "//java/org/trailcatalog/client/models",
        "//java/org/trailcatalog/client/workers:ts",
        "//java/org/trailcatalog/models:models-ts",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "//js/map",
        "//js/map/rendering",
    ],
)

