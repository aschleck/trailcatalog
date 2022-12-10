package(default_visibility = [":internal"])

load("@build_bazel_rules_nodejs//:index.bzl", "copy_to_bin")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

package_group(
    name = "internal",
    packages = [
        "//java/org/trailcatalog/...",
        "//javatests/org/trailcatalog/...",
    ],
)

pkg_tar(
    name = "full_pkg",
    srcs = [
        ":api_server_deploy.jar",
        ":frontend_pkg",
        ":static_data",
    ],
    stamp = 1,
)

pkg_files(
    name = "frontend_pkg",
    srcs = [
        "//java/org/trailcatalog/frontend:frontend.js",
        "//java/org/trailcatalog/frontend:frontend.js.map",
    ],
    prefix = "frontend",
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
        "EpochTracker.kt",
        "Frontend.kt",
    ],
    data = [
        "//java/org/trailcatalog/static",
    ],
    deps = [
        ":pg_support",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:io_javalin_javalin",
        "@maven//:org_slf4j_slf4j_simple",
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

copy_to_bin(
    name = "assets",
    srcs = glob(["*.html"]),
)
