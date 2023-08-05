package(default_visibility = ["//java/lat/trails:internal"])

load("@aspect_rules_js//js:defs.bzl", "js_library")

filegroup(
    name = "static",
    srcs = [
        ":copies",
        ":glob",
    ],
)

js_library(
    name = "glob",
    srcs = glob(["*.webp"]),
)

genrule(
    name = "copies",
    srcs = [
        "//java/lat/trails/client",
        "//java/org/trailcatalog/client/workers:data_fetcher_worker",
        "//js/map/workers:tile_fetcher_worker",
    ],
    outs = [
        "client.css",
        "client.js",
        "client.js.map",
        "data_fetcher_worker.js",
        "data_fetcher_worker.js.map",
        "tile_fetcher_worker.js",
        "tile_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)

