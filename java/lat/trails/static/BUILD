package(default_visibility = ["//java/lat/trails:internal"])

load("@aspect_rules_js//js:defs.bzl", "js_library")

filegroup(
    name = "static",
    srcs = [
        ":atlases",
        ":copies",
        ":glob",
    ],
)

genrule(
    name = "atlases",
    srcs = ["//java/org/trailcatalog/static:images/atlases/points.png"],
    outs = ["images/atlases/points.png"],
    cmd = "cp $< $@",
)

js_library(
    name = "glob",
    srcs = glob(["*.svg", "*.webp"], allow_empty=True),
)

genrule(
    name = "copies",
    srcs = [
        "//java/lat/trails/client",
        "//java/lat/trails/client/workers:collection_loader_worker",
        "//js/map/workers:earth_search_loader_worker",
        "//js/map/workers:elevation_sampler_worker",
        "//js/map/workers:location_querier_worker",
        "//js/map/workers:mbtile_loader_worker",
        "//js/map/workers:raster_loader_worker",
        "//js/map/workers:s2_data_fetcher_worker",
        "//js/map/workers:slope_loader_worker",
        "//js/map/workers:wind_loader_worker",
        "//js/map/workers:xyz_data_fetcher_worker",
        "//third_party/emojibase:emoji.json",
    ],
    outs = [
        "client.css",
        "client.js",
        "client.js.map",
        "collection_loader_worker.js",
        "collection_loader_worker.js.map",
        "earth_search_loader_worker.js",
        "earth_search_loader_worker.js.map",
        "elevation_sampler_worker.js",
        "elevation_sampler_worker.js.map",
        "emoji.json",
        "location_querier_worker.js",
        "location_querier_worker.js.map",
        "mbtile_loader_worker.js",
        "mbtile_loader_worker.js.map",
        "raster_loader_worker.js",
        "raster_loader_worker.js.map",
        "s2_data_fetcher_worker.js",
        "s2_data_fetcher_worker.js.map",
        "slope_loader_worker.js",
        "slope_loader_worker.js.map",
        "wind_loader_worker.js",
        "wind_loader_worker.js.map",
        "xyz_data_fetcher_worker.js",
        "xyz_data_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)

