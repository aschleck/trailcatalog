package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "ts",
    css_deps = [
        "//js/dino:css",
    ],
    deps = [
        "//java/org/trailcatalog/client/data",
        "//java/org/trailcatalog/client/map",
        "//js/dino",
        "//js/map",
        "//js/map/layers",
        "//js/units",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/server:client",
    ],
)

