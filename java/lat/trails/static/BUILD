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
        "//java/lat/trails/client/workers:collection_loader_worker",
        "//js/map2/workers:location_querier_worker",
        "//js/map2/workers:mbtile_loader_worker",
        "//js/map2/workers:raster_loader_worker",
        "//js/map2/workers:s2_data_fetcher_worker",
        "//js/map2/workers:xyz_data_fetcher_worker",
    ],
    outs = [
        "client.css",
        "client.js",
        "client.js.map",
        "collection_loader_worker.js",
        "collection_loader_worker.js.map",
        "location_querier_worker.js",
        "location_querier_worker.js.map",
        "mbtile_loader_worker.js",
        "mbtile_loader_worker.js.map",
        "raster_loader_worker.js",
        "raster_loader_worker.js.map",
        "s2_data_fetcher_worker.js",
        "s2_data_fetcher_worker.js.map",
        "xyz_data_fetcher_worker.js",
        "xyz_data_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)

