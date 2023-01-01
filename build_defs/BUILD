package(default_visibility = ["//visibility:public"])

load("@aspect_rules_js//js:defs.bzl", "js_library")

js_library(
    name = "esbuild_config",
    srcs = [
        "esbuild.config.mjs",
    ],
    deps = [
        ":esbuild_config_deps",
        "//third_party/deanc-esbuild-plugin-postcss",
    ],
)

js_library(
    name = "esbuild_config_deps",
    srcs = [
        "postcss.config.mjs",
        "tailwind.config.js",
    ],
    deps = [
        "//:node_modules/autoprefixer",
        "//:node_modules/tailwindcss",
    ],
)

js_library(
    name = "jest_config",
    srcs = [
        "jest.config.js",
    ],
)

