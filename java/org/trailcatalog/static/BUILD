package(default_visibility = ["//visibility:public"])

filegroup(
    name = "static",
    srcs = glob(["images/**/*"]) + [
        ":js",
    ],
)

genrule(
    name = "js",
    srcs = [
        "//java/org/trailcatalog/client",
        "//java/org/trailcatalog/client/workers:data_fetcher_worker",
        "//js/map/workers:mbtile_loader_worker",
        "//js/map/workers:raster_loader_worker",
        "//js/map/workers:xyz_data_fetcher_worker",
    ],
    outs = [
        "client.css",
        "client.js",
        "client.js.map",
        "data_fetcher_worker.js",
        "data_fetcher_worker.js.map",
        "mbtile_loader_worker.js",
        "mbtile_loader_worker.js.map",
        "raster_loader_worker.js",
        "raster_loader_worker.js.map",
        "xyz_data_fetcher_worker.js",
        "xyz_data_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)

