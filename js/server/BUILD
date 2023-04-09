package(default_visibility = ["//visibility:public"])

load("//build_defs:ts.bzl", "tc_ts_project", "ts_project")

tc_ts_project(
    name = "server",
    srcs = glob(
        ["*.ts"],
        exclude = ["data.ts"],
    ),
    deps = [
        ":data",
        "//:node_modules/@fastify/request-context",
        "//:node_modules/@types/node",
        "//:node_modules/fastify",
        "//:node_modules/node-fetch",
        "//js/common",
        "//js/corgi",
    ],
)

ts_project(
    name = "data",
    srcs = ["data.ts"],
)
