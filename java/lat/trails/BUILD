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
        "//javatests/lat/trails/...",
        "//production/...",
    ],
)

pkg_tar(
    name = "frontend_pkg",
    srcs = [
        ":api_server_deploy.jar",
        ":static_data",
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
    srcs = glob(["static/*.svg", "static/*.webp"]) + [
        ":bundle",
        "//java/org/trailcatalog:static/images/atlases/points.png",
        "//third_party/emojibase:emoji.json",
    ],
    replace_prefixes = {
        "bundle/": "",
        "java/org/trailcatalog/static/": "",
        "static/": "",
        "third_party/emojibase/": "",
    },
)

esbuild_binary(
    name = "bundle",
    entry_points = {
        "//java/lat/trails/client:app.tsx": "client",
        "//java/lat/trails/client/workers:collection_loader.ts": "collection_loader_worker",
        "//js/map/workers:elevation_sampler.ts": "elevation_sampler_worker",
        "//js/map/workers:location_querier.ts": "location_querier_worker",
        "//js/map/workers:mbtile_loader.ts": "mbtile_loader_worker",
        "//js/map/workers:raster_loader.ts": "raster_loader_worker",
        "//js/map/workers:s2_data_fetcher.ts": "s2_data_fetcher_worker",
        "//js/map/workers:slope_loader.ts": "slope_loader_worker",
        "//js/map/workers:stac_loader.ts": "stac_loader_worker",
        "//js/map/workers:wind_loader.ts": "wind_loader_worker",
        "//js/map/workers:xyz_data_fetcher.ts": "xyz_data_fetcher_worker",
    },
    deps = [
        "//java/lat/trails/client:css",
        "//java/lat/trails/client:ts",
        "//java/lat/trails/client/workers",
        "//js/map/workers",
    ],
)

java_binary(
    name = "api_server",
    main_class = "lat.trails.ApiServerKt",
    runtime_deps = [":api_server_lib"],
)

kt_jvm_library(
    name = "api_server_lib",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/lat/trails/common",
        "//java/lat/trails/wire",
        "//trails_lat/proto:data_java_proto",
        "//java/org/trailcatalog:epoch_tracker",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-kt",
        "@com_google_geometry_s2//:s2",
        "@protobuf//java/util",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:io_javalin_javalin",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
