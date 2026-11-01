package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "ts",
    deps = [
        "//:node_modules/@types/node",
        "//java/lat/trails/client/account",
        "//java/lat/trails/client/data",
        "//java/lat/trails/client/layers",
        "//java/lat/trails/client/model",
        "//java/lat/trails/client/sky",
        "//java/lat/trails/client/tools",
        "//java/lat/trails/client/ui",
        "//java/lat/trails/client/workers",
        "//java/org/trailcatalog/models:models-ts",
        "//java/org/trailcatalog/s2",
        "//js/map",
        "//js/map/common",
        "//js/map/layers",
        "//js/map/workers/elevation",
        "//js/map/workers/routing",
        "//js/pika",
        "//js/units",
        "//js/wikimedia",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/data",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/emu/menu",
        "@dev_april_corgi//js/server:client",
    ],
)
