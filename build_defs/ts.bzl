load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_jest//jest:defs.bzl", "jest_test")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")

def esbuild_binary(
        name,
        entry_point = None,
        deps = None,
        platform = "browser",
):
    has_css = native.glob(["*.css"]) != []
    esbuild(
        name = name,
        config = "//build_defs:esbuild_config",
        entry_point = entry_point,
        srcs = [
            entry_point,
        ],
        deps = (deps or []) + [
            # No idea why these are required here, it's in the deps of the esbuild config.
            "//build_defs:esbuild_config_deps",
            "//third_party/deanc-esbuild-plugin-postcss",
        ],
        minify = True,
        output_css = "%s.css" % name if has_css else None,
        platform = platform,
        sources_content = True,
        target = "es2020",
    )


def tc_ts_project(name, srcs = None, css_deps = None, data = None, deps = None):
    srcs = srcs or native.glob(["*.ts", "*.tsx"], exclude=["*.test.ts", "*.test.tsx"])

    ts_project(
        name = name,
        srcs = srcs,
        allow_js = True,
        declaration = True,
        tsconfig = "//:tsconfig",
        data = data or [],
        deps = deps or [],
    )

    if native.glob(["*.css"]):
        copy_to_bin(
            name = name + "_css",
            srcs = native.glob(["*.css"]),
        )
        js_library(
            name = "css",
            srcs = (css_deps or []) + [
                ":{}_css".format(name),
            ],
        )
    else:
        js_library(
            name = "css",
            data = css_deps or [],
        )

    ts_project(
        name = "tests",
        srcs = native.glob(["*.test.ts", "*.test.tsx"]),
        allow_js = True,
        declaration = True,
        tsconfig = "//:tsconfig",
        deps = [
            ":%s" % name,
            "//:node_modules/@types/jest",
            "//:node_modules/jest-environment-jsdom",
        ],
    )

    jest_test(
        name = "jest",
        config = "//build_defs:jest_config",
        data = [
            ":tests",
        ],
    )

