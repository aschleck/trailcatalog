package(default_visibility = ["//visibility:public"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild_config")

esbuild_config(
    name = "esbuild_config",
    config_file = "esbuild.config.mjs",
    srcs = [
        "postcss.config.mjs",
        "tailwind.config.js",
    ],
    deps = [
        "@npm//@deanc/esbuild-plugin-postcss",
        "@npm//autoprefixer",
        "@npm//tailwindcss",
    ],
)
