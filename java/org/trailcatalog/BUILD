load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

package(default_visibility = [":internal"])

package_group(
    name = "internal",
    packages = [
        "//java/lat/trails/...",
        "//java/org/trailcatalog/...",
        "//javatests/org/trailcatalog/...",
        "//js/map/...",
        "//js/s2viewer/...",
        "//production/...",
    ],
)

pkg_tar(
    name = "frontend_pkg",
    srcs = [
        ":api_server_deploy.jar",
        ":static_data",
        "//java/org/trailcatalog/frontend:frontend.js",
        "//java/org/trailcatalog/frontend:frontend.js.map",
        "//js/s2viewer:s2_pkg",
    ],
    package_dir = "app",
    stamp = 1,
)

pkg_files(
    name = "static_data",
    srcs = [
        "//java/org/trailcatalog/static",
    ],
    prefix = "static",
    strip_prefix = strip_prefix.from_pkg(),
)

java_binary(
    name = "api_server",
    main_class = "org.trailcatalog.FrontendKt",
    runtime_deps = [":frontend_lib"],
)

kt_jvm_library(
    name = "frontend_lib",
    srcs = [
        "Frontend.kt",
    ],
    data = [
        "//java/org/trailcatalog/static",
    ],
    deps = [
        ":epoch_tracker",
        ":pg_support",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "@bazel_tools//tools/java/runfiles",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:io_javalin_javalin",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)

kt_jvm_library(
    name = "epoch_tracker",
    srcs = [
        "EpochTracker.kt",
    ],
    deps = [
        "@maven//:com_zaxxer_HikariCP",
    ],
)

kt_jvm_library(
    name = "pg_support",
    srcs = ["PgSupport.kt"],
    runtime_deps = [
        "@maven//:org_postgresql_postgresql",
    ],
    deps = [
        "@maven//:com_zaxxer_HikariCP",
    ],
)
