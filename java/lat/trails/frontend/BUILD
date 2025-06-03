package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_binary")

js_binary(
    name = "runner",
    data = [
        ":frontend.js",
        "//java/lat/trails/static",
    ],
    entry_point = "frontend.js",
    node_options = [
        "--enable-source-maps",
    ],
)

esbuild_binary(
    name = "frontend",
    entry_point = "server.ts",
    minify = False,
    platform = "node",
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    css_deps = [
        "//java/lat/trails/client:css",
    ],
    deps = [
        "//:node_modules/@fastify/cookie",
        "//:node_modules/@fastify/reply-from",
        "//:node_modules/fastify",
        "//:node_modules/openid-client",
        "//:node_modules/postgres",
        "//java/lat/trails/client:ts",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/server",
    ],
)
