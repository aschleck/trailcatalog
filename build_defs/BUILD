package(default_visibility = ["//visibility:public"])

load("@aspect_rules_js//js:defs.bzl", "js_library")

exports_files([
    "esbuild.config.mjs",
    "postcss.config.mjs",
    "tailwind.config.mjs",
])

js_library(
    name = "jest_config",
    srcs = [
        "jest.config.js",
    ],
)

