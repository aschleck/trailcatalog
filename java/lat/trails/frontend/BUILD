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
)

esbuild_binary(
    name = "frontend",
    entry_point = "server.js",
    minify = False,
    platform = "node",
    css_deps = [
        ":css",
    ],
    deps = [
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
        "//:node_modules/@types/pg",
        "//:node_modules/openid-client",
        "//:node_modules/pg",
        "//java/lat/trails/client:ts",
        "//js/corgi",
        "//js/server",
    ],
)
