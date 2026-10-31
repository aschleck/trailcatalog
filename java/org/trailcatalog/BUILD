load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("//build_defs:ts.bzl", "esbuild_binary")

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
        "//js/s2viewer:s2_pkg",
    ],
    package_dir = "app",
    stamp = 1,
)

pkg_files(
    name = "static_data",
    srcs = [
        ":static",
    ],
    strip_prefix = strip_prefix.from_pkg(),
)

# Workers and assets are found relative to import.meta.url, which in a shared chunk is the chunk's
# URL, so the bundle's files and the assets have to sit in one flat directory.
copy_to_directory(
    name = "static",
    srcs = glob(["static/images/**/*"]) + [
        ":bundle",
    ],
    replace_prefixes = {
        "bundle/": "",
        "static/": "",
    },
)

esbuild_binary(
    name = "bundle",
    entry_points = {
        "//java/org/trailcatalog/client:app.tsx": "client",
        "//java/org/trailcatalog/client/workers:data_fetcher.ts": "data_fetcher_worker",
        "//js/map/workers:mbtile_loader.ts": "mbtile_loader_worker",
        "//js/map/workers:raster_loader.ts": "raster_loader_worker",
        "//js/map/workers:xyz_data_fetcher.ts": "xyz_data_fetcher_worker",
    },
    deps = [
        "//java/org/trailcatalog/client:css",
        "//java/org/trailcatalog/client:ts",
        "//java/org/trailcatalog/client/workers:ts",
        "//js/map/workers",
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
        "Frontend.kt",
    ],
    data = [
        ":static",
    ],
    deps = [
        ":epoch_tracker",
        ":pg_support",
        ":search_names",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "//java/org/trailcatalog/s2:s2-kt",
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
    name = "search_names",
    srcs = ["SearchNames.kt"],
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
