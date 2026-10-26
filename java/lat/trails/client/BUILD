package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "ts",
    deps = [
        "//:node_modules/@bufbuild/protobuf",
        "//:node_modules/@types/node",
        "//java/lat/trails/client/workers",
        "//java/lat/trails/wire:wire-ts",
        "//java/org/trailcatalog/client/points",
        "//java/org/trailcatalog/s2",
        "//js/cookies",
        "//js/pika",
        "//js/map",
        "//js/map/layers",
        "//js/map/workers",
        "//js/units",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/data",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/emu/menu",
        "@dev_april_corgi//js/server:client",
    ],
)
