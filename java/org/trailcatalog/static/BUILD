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
    ],
    outs = [
        "client.js",
        "client.js.map",
    ],
    cmd = "\n".join([
        "for i in $(locations //java/org/trailcatalog/client); do",
        "  cp \"$${i}\" \"$(@D)/$$(basename \"$${i}\")\"",
        "done",
    ]),
)
