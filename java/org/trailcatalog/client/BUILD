package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild", "esbuild_config")
load("@npm//jest-cli:index.bzl", "jest_test")
load("@npm//@bazel/typescript:index.bzl", "ts_project")
load("@build_bazel_rules_nodejs//packages/concatjs:index.bzl", "ts_library")

esbuild(
    name = "client",
    config = ":esbuild_config",
    entry_point = "app.ts",
    link_workspace_root = True,
    sourcemap = "both",
    target = "es2020",
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
    srcs = glob(["*.ts"], exclude=["*.test.ts"]),
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        "//java/org/trailcatalog/client/models",
        "//java/org/trailcatalog/client/workers:ts",
        "//java/org/trailcatalog/s2",
    ],
)

ts_project(
    name = "tests",
    srcs = glob(["*.test.ts"]),
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        ":ts",
        "@npm//@types/jest",
    ],
)

jest_test(
    name = "jest",
    data = [
        ":tests",
        "//:jest.config.js",
    ],
    args = [
        "--node_options=--experimental-vm-modules",
        "--no-cache",
        "--no-watchman",
        "--ci",
        "--colors",
        "--config",
        "jest.config.js",
    ],
)
