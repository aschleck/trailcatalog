package(default_visibility = ["//visibility:private"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")

esbuild_binary(
    name = "s2viewer",
    entry_point = "app.js",
    minify = False,
    deps = [
        ":css",
        ":ts",
    ],
)

tc_ts_project(
    name = "ts",
    deps = [
        "//java/org/trailcatalog/client/common",
        "//js/map",
        "//js/map/layers",
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

genrule(
    name = "static",
    srcs = [
        ":s2viewer.css",
        ":s2viewer.js",
        ":s2viewer.js.map",
        "//js/map/workers:mbtile_loader_worker",
        "//js/map/workers:raster_loader_worker",
        "//js/map/workers:xyz_data_fetcher_worker",
    ],
    outs = [
        "static/s2viewer.css",
        "static/s2viewer.js",
        "static/s2viewer.js.map",
        "static/mbtile_loader_worker.js",
        "static/mbtile_loader_worker.js.map",
        "static/raster_loader_worker.js",
        "static/raster_loader_worker.js.map",
        "static/xyz_data_fetcher_worker.js",
        "static/xyz_data_fetcher_worker.js.map",
    ],
    cmd = "\n".join([
        "mkdir -p \"$(@D)/static\"",
        "for i in $(SRCS); do",
        "  cp \"$${i}\" \"$(@D)/static/$$(basename \"$${i}\")\"",
        "done",
    ]),
)
