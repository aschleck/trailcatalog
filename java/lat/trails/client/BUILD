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
        "//:node_modules/@types/node",
        "//java/lat/trails/client/workers",
        "//js/map",
        "//js/map/layers",
        "//js/map/workers",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/emu",
        "@dev_april_corgi//js/server:client",
    ],
)
