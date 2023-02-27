package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "map",
    deps = [
        "//java/org/trailcatalog/client/common",
        "//java/org/trailcatalog/client/map/models",
        "//java/org/trailcatalog/client/map/rendering",
        "//java/org/trailcatalog/client/models",
        "//java/org/trailcatalog/client/workers:ts",
        "//java/org/trailcatalog/s2",
        "//js/corgi",
        "//js/corgi/history",
    ],
)

