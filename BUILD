package(default_visibility = ["//visibility:public"])

load("@npm//@bazel/typescript:index.bzl", "ts_config")

exports_files(["jest.config.js", "tsconfig.json"])

ts_config(
    name = "tsconfig",
    src = "tsconfig.json",
)

ts_config(
    name = "tsconfig_jest",
    src = "tsconfig.jest.json",
    deps = [
        ":tsconfig",
    ],
)
