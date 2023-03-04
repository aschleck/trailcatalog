package(default_visibility = ["//visibility:private"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")

esbuild_binary(
    name = "s2viewer",
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
        "//java/org/trailcatalog/client/map",
        "//js/common",
        "//js/corgi",
        "//js/map",
    ],
)

genrule(
    name = "workers",
    srcs = [
        "//java/org/trailcatalog/client/workers:tile_fetcher_worker",
    ],
    outs = [
        "tile_fetcher_worker.js",
        "tile_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)

