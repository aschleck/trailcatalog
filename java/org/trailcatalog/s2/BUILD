package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@j2cl//build_defs:rules.bzl", "j2cl_application", "j2cl_library")
load("@rules_java//java:java_library.bzl", "java_library")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

tc_ts_project(
    name = "s2",
    srcs = [
        "SimpleS2.ts",
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
    ],
)

j2cl_application(
    name = "s2_raw",
    entry_points = ["org.trailcatalog.s2.externs"],
    extra_production_args = [
        "--compilation_level=ADVANCED",
        "--language_in=ECMASCRIPT_2020",
        "--language_out=ECMASCRIPT_2020",
    ],
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
        "@elemental2//:elemental2-core-j2cl",
        "@j2cl//:jsinterop-annotations-j2cl",
        "@jsinterop_base//:jsinterop-base-j2cl",
    ],
)

java_library(
    name = "s2-java",
    srcs = glob(["*.java"]),
    deps = [
        "@com_google_geometry_s2//:s2",
        "@elemental2//:elemental2-core",
        "@j2cl//:jsinterop-annotations",
        "@jsinterop_base//:jsinterop-base",
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
