package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "data",
    deps = [
        "//java/org/trailcatalog/client/models",
        "//java/org/trailcatalog/client/workers:ts",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "//js/map",
        "//js/map/common",
    ],
)

