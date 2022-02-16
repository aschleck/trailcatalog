package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild", "esbuild_config")
load("@npm//@bazel/typescript:index.bzl", "ts_config", "ts_project")
load("@build_bazel_rules_nodejs//packages/concatjs:index.bzl", "ts_library")

esbuild(
    name = "client",
    config = ":esbuild_config",
    entry_point = "app.ts",
    link_workspace_root = True,
    sourcemap = "both",
    deps = [
        ":ts",
        "@npm//esbuild",
    ],
)

esbuild_config(
    name = "esbuild_config",
    config_file = "esbuild.config.mjs",
)

ts_project(
    name = "ts",
    srcs = glob(["*.ts"]),
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        "//java/org/trailcatalog/s2",
        "@npm//@luma.gl/shadertools",
    ],
)
