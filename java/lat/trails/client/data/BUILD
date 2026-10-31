package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "data",
    deps = [
        "//:node_modules/@bufbuild/protobuf",
        "//java/lat/trails/wire:wire-ts",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/data",
    ],
)
