package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@build_bazel_rules_nodejs//:index.bzl", "js_library")
load("@build_bazel_rules_nodejs//packages/concatjs:index.bzl", "ts_library")
load("@com_google_j2cl//build_defs:rules.bzl", "j2cl_application", "j2cl_library")
load("@io_bazel_rules_closure//closure:defs.bzl", "closure_js_binary", "closure_js_library")
load("@npm//@bazel/typescript:index.bzl", "ts_config", "ts_project")

ts_project(
    name = "s2",
    srcs = ["SimpleS2.ts"],
    allow_js = True,
    declaration = True,
    tsconfig = "//:tsconfig",
    deps = [
        ":s2_typed",
    ],
)

js_library(
    name = "s2_typed",
    srcs = [
        "s2_raw.d.ts",
        ":s2_raw.js",
    ],
)

j2cl_application(
    name = "s2_raw",
    entry_points = ["org.trailcatalog.s2.externs"],
    extra_production_args = ["--compilation_level=SIMPLE"],
    deps = [
        ":s2-j2cl",
    ],
)

j2cl_library(
    name = "s2-j2cl",
    srcs = glob([
        "*.java",
        "*.js",
    ]),
    deps = [
        "@com_google_geometry_s2//:s2-j2cl",
        "@com_google_guava-j2cl",
        "@com_google_j2cl//:jsinterop-annotations-j2cl",
    ],
)
