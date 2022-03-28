package(default_visibility = ["//java/org/trailcatalog:internal"])

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
    data = [
        "//java/org/trailcatalog:assets",
    ],
    deps = [
        "//java/org/trailcatalog/client/map",
        "//js/corgi",
    ],
)

