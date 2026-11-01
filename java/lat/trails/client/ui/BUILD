package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "ui",
    deps = [
        "//java/lat/trails/client/data",
        "//java/lat/trails/client/model",
        "//java/lat/trails/client/sky",
        "//java/lat/trails/client/tools",
        "//java/lat/trails/client/workers",
        "//java/org/trailcatalog/models:models-ts",
        "//java/org/trailcatalog/s2",
        "//js/cookies",
        "//js/map",
        "//js/map/rendering",
        "//js/map/workers/elevation",
        "//js/pika",
        "//js/units",
        "//js/wikimedia",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/data",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/emu/menu",
    ],
)
