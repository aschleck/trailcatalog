package(default_visibility = ["//visibility:private"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "s2client",
    entry_point = "app.js",
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    data = [
        "index.html",
    ],
    deps = [
        "//js/common",
        "//js/corgi",
    ],
)

