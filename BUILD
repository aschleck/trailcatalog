package(default_visibility = ["//visibility:public"])

load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("@npm//:defs.bzl", "npm_link_all_packages")
load("@rules_python//python:pip.bzl", "compile_pip_requirements")

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

npm_link_all_packages(name = "node_modules")

compile_pip_requirements(
    name = "requirements_lock",
    extra_args = ["--allow-unsafe"],
)
