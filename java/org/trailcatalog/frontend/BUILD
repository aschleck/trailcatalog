package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_binary")

js_binary(
    name = "runner",
    data = [
        ":frontend",
    ],
    entry_point = "frontend.js",
    node_options = [
        "--enable-source-maps",
    ],
)

esbuild_binary(
    name = "frontend",
    entry_point = "server.js",
    minify = False,
    platform = "node",
    deps = [
        ":css",
        ":ts",
    ],
)

genrule(
    name = "assets",
    srcs = ["//java/org/trailcatalog/static"],
    outs = ["assets.ts"],
    cmd = "$(execpath //py:static_prefix) $@ /static $(SRCS)",
    tools = ["//py:static_prefix"],
)

tc_ts_project(
    name = "ts",
    srcs = glob(["*.ts"]) + [":assets"],
    css_deps = [
        "//java/org/trailcatalog/client:css",
    ],
    deps = [
        "//java/org/trailcatalog/client:ts",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/server",
    ],
)
