package(default_visibility = ["//visibility:public"])

filegroup(
    name = "static",
    srcs = [
        ":js",
    ],
)

genrule(
    name = "js",
    srcs = [
        "//java/org/trailcatalog/client",
        "//java/org/trailcatalog/client/workers:fetcher_worker",
    ],
    outs = [
        "client.js",
        "client.js.map",
        "fetcher_worker.js",
        "fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "for i in $(locations //java/org/trailcatalog/client); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
        "for i in $(locations //java/org/trailcatalog/client/workers:fetcher_worker); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)
