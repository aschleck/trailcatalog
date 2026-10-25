package(default_visibility = ["//visibility:private"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")

esbuild_binary(
    name = "static",
    entry_points = {
        "app.tsx": "s2viewer",
        "//js/map/workers:mbtile_loader.ts": "mbtile_loader_worker",
        "//js/map/workers:raster_loader.ts": "raster_loader_worker",
        "//js/map/workers:xyz_data_fetcher.ts": "xyz_data_fetcher_worker",
    },
    minify = False,
    deps = [
        ":css",
        ":ts",
        "//js/map/workers",
    ],
)

tc_ts_project(
    name = "ts",
    deps = [
        "//js/map",
        "//js/map/layers",
        "//js/units",
        "@dev_april_corgi//js/common",
        "@dev_april_corgi//js/corgi",
        "@dev_april_corgi//js/emu",
    ],
)

pkg_files(
    name = "s2_pkg",
    srcs = [
        ":copy",
        ":static",
    ],
    prefix = "s2",
    strip_prefix = strip_prefix.from_pkg(),
    visibility = [
        "//java/org/trailcatalog:__subpackages__",
    ],
)

copy_to_bin(
    name = "copy",
    srcs = [
        "index.html",
    ],
)
