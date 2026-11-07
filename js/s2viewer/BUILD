package(default_visibility = ["//visibility:private"])

load("//build_defs:ts.bzl", "esbuild_binary", "tc_ts_project")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")

esbuild_binary(
    name = "static",
    entry_points = {
        "app.tsx": "s2viewer",
        "//js/map/workers/tiles:mbtile_loader.ts": "mbtile_loader_worker",
        "//js/map/workers/raster:raster_loader.ts": "raster_loader_worker",
        "//js/map/workers/tiles:xyz_data_fetcher.ts": "xyz_data_fetcher_worker",
    },
    minify = False,
    deps = [
        ":css",
        ":ts",
        "//js/map/workers",
        "//js/map/workers/raster",
        "//js/map/workers/tiles",
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
        ":index",
        ":static",
    ],
    prefix = "s2",
    strip_prefix = strip_prefix.from_pkg(),
    visibility = [
        "//java/org/trailcatalog:__subpackages__",
    ],
)

genrule(
    name = "prefix",
    srcs = [":static"],
    outs = ["static_prefix.ts"],
    cmd = "$(execpath //py:static_prefix) $@ /static $(SRCS)",
    tools = ["//py:static_prefix"],
)

genrule(
    name = "index",
    srcs = [
        "index.template.html",
        ":prefix",
    ],
    outs = ["index.html"],
    cmd = "prefix=$$(cut -d \"'\" -f2 $(location :prefix)) && " +
          "sed \"s#STATIC_PREFIX#$$prefix#g\" $(location index.template.html) > $@",
)
