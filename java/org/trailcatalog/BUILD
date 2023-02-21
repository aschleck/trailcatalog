package(default_visibility = [":internal"])

load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

package_group(
    name = "internal",
    packages = [
        "//java/org/trailcatalog/...",
        "//javatests/org/trailcatalog/...",
        "//production/...",
    ],
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
