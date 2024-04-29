package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "client",
    entry_point = "app.tsx",
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    deps = [
        "//java/lat/trails/client/workers",
        "//js/common",
        "//js/corgi",
        "//js/map",
        "//js/map/layers",
        "//js/map/workers",
        "//js/server:client",
    ],
)

