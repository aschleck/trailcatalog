package(default_visibility = [":internal"])

load("@build_bazel_rules_nodejs//:index.bzl", "copy_to_bin")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files")
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
        ":frontend_data",
        ":frontend_deploy.jar",
        ":import_osm_deploy.jar",
        ":seed_trails_deploy.jar",
    ],
    stamp = 1,
)

pkg_files(
    name = "frontend_data",
    srcs = [
        ":index.html",
        "//java/org/trailcatalog/static",
    ],
    prefix = "static",
)

java_binary(
    name = "frontend",
    main_class = "org.trailcatalog.FrontendKt",
    runtime_deps = [":frontend_lib"],
)

kt_jvm_library(
    name = "frontend_lib",
    srcs = ["Frontend.kt"],
    data = [
        ":index.html",
        "//java/org/trailcatalog/static",
    ],
    deps = [
        ":pg_support",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "@bazel_tools//tools/java/runfiles",
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

java_binary(
    name = "import_osm",
    main_class = "org.trailcatalog.ImportOsmKt",
    runtime_deps = [":import_lib"],
)

java_binary(
    name = "seed_trails",
    main_class = "org.trailcatalog.SeedTrailsFromOsmKt",
    runtime_deps = [":import_lib"],
)

kt_jvm_library(
    name = "import_lib",
    srcs = [
        "ImportOsm.kt",
        "SeedTrailsFromOsm.kt",
    ],
    data = [
        "washington-latest.osm.pbf",
    ],
    deps = [
        ":pg_support",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/pbf",
        "//java/org/trailcatalog/s2:s2-java",
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk7",
        "@maven//:org_postgresql_postgresql",
    ],
)
