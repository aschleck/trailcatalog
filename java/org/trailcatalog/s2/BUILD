package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@com_google_geometry_s2//js:exports.bzl", "s2_output_wrapper")
load("@j2cl//build_defs:rules.bzl", "j2cl_application", "j2cl_library")
load("@rules_java//java:java_library.bzl", "java_library")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

tc_ts_project(
    name = "s2",
    srcs = [
        "index.ts",
    ],
    deps = [
        "//:node_modules/@types/node",
        ":s2_typed",
    ],
)

js_library(
    name = "s2_typed",
    srcs = [
        "s2_raw.d.ts",
        ":s2_raw.js",
        "@com_google_geometry_s2//js:index_dts",
    ],
)

j2cl_application(
    name = "s2_raw",
    entry_points = [
        "org.trailcatalog.s2.exports",
        "s2.npm.exports",
    ],
    extra_production_args = [
        "--compilation_level=ADVANCED",
        "--language_in=ECMASCRIPT_2020",
        "--language_out=ECMASCRIPT_2020",
    ],
    output_wrapper = s2_output_wrapper(extra_exports = ["SimpleS2"]),
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
        "@com_google_geometry_s2//:com_google_guava-j2cl",
        "@com_google_geometry_s2//:s2-j2cl",
        "@com_google_geometry_s2//js:npm_exports",
        "@j2cl//:jsinterop-annotations-j2cl",
    ],
)

java_library(
    name = "s2-java",
    srcs = glob(["*.java"]),
    deps = [
        "@com_google_geometry_s2//:s2",
        "@j2cl//:jsinterop-annotations",
        "@maven//:com_google_guava_guava",
    ],
)

kt_jvm_library(
    name = "s2-kt",
    srcs = glob(["*.kt"]),
    deps = [
        ":s2-java",
        "@com_google_geometry_s2//:s2",
    ],
)
