package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "model",
    deps = [
        "//:node_modules/@bufbuild/protobuf",
        "//java/lat/trails/client/workers",
        "//java/org/trailcatalog/models:models-ts",
        "//js/map/common",
        "//js/map/rendering",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
    ],
)
