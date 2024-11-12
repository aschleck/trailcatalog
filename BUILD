package(default_visibility = ["//visibility:public"])

load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("@npm//:defs.bzl", "npm_link_all_packages")
load("@rules_python//python:pip.bzl", "compile_pip_requirements")

js_library(
    name = "package_json",
    srcs = ["package.json"],
)

ts_config(
    name = "tsconfig",
    src = "tsconfig.json",
    deps = [
        "//:node_modules/gts",
    ],
)

npm_link_all_packages(name = "node_modules")

compile_pip_requirements(
    name = "requirements_lock",
    extra_args = ["--allow-unsafe"],
)
