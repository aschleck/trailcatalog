package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")

tc_ts_project(
    name = "account",
    deps = [
        "//java/lat/trails/client/data",
        "//java/lat/trails/client/login",
        "//java/lat/trails/client/ui",
        "//java/lat/trails/client/workers",
        "//js/pika",
        "//trails_lat/proto:data_ts_proto",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/emu",
    ],
)
