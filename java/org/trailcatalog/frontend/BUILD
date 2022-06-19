package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_binary")

nodejs_binary(
    name = "runner",
    entry_point = "frontend.js",
    data = [
        ":frontend.js",
    ],
)

esbuild_binary(
    name = "frontend",
    entry_point = "server.ts",
    platform = "node",
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    css_deps = [
        "//java/org/trailcatalog/client:css",
    ],
    deps = [
        "//java/org/trailcatalog/client:ts",
        "//java/org/trailcatalog/client/common",
        "//js/corgi",
        "@npm//fastify",
        "@npm//node-fetch",
        "@npm//@fastify/request-context",
        "@npm//@types/node",
    ],
)

