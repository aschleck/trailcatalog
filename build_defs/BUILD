package(default_visibility = ["//visibility:public"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild_config")

exports_files(["jest.config.js"])

esbuild_config(
    name = "esbuild_config",
    srcs = [
        "postcss.config.mjs",
        "tailwind.config.js",
    ],
    config_file = "esbuild.config.mjs",
    deps = [
        "@npm//@deanc/esbuild-plugin-postcss",
        "@npm//autoprefixer",
        "@npm//tailwindcss",
    ],
)
