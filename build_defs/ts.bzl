load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_jest//jest:defs.bzl", "jest_test")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")

def esbuild_binary(
        name,
        entry_point = None,
        css_deps = None,
        deps = None,
        platform = "browser",
        minify = True):
    has_css = len(native.glob(["*.css"])) > 0 or len(css_deps or []) > 0
    esbuild(
        name = name,
        config = "//build_defs:esbuild_config",
        entry_point = entry_point,
        srcs = [
            entry_point,
        ],
        deps = (css_deps or []) + (deps or []) + [
            # No idea why these are required here, it's in the deps of the esbuild config.
            "//build_defs:esbuild_config_deps",
            "//third_party/deanc-esbuild-plugin-postcss",
        ],
        minify = minify,
        output_css = "%s.css" % name if has_css else None,
        platform = platform,
        sources_content = True,
        target = "es2020",
    )

def tc_ts_project(name, srcs = None, css_deps = None, data = None, deps = None):
    srcs = srcs or native.glob(["*.ts", "*.tsx"], exclude = ["*.test.ts", "*.test.tsx"])

    ts_project(
        name = name,
        srcs = srcs,
        data = data,
        deps = deps,
    )

    if native.glob(["*.css"]):
        js_library(
            name = "css",
            srcs = native.glob(["*.css"]),
            deps = css_deps or [],
        )
    else:
        js_library(
            name = "css",
            deps = css_deps or [],
        )

    ts_project(
        name = "tests",
        srcs = native.glob(["*.test.ts", "*.test.tsx"]),
        deps = [
            ":%s" % name,
            "//:node_modules/@types/jest",
            "//:node_modules/jest-environment-jsdom",
        ],
    )

    jest_test(
        name = "jest",
        config = "//build_defs:jest_config",
        node_modules = "//:node_modules",
        data = [
            ":tests",
        ],
    )

def ts_project(name, deps = None, **kwargs):
    _ts_project(
        name = name,
        allow_js = True,
        declaration = True,
        tsconfig = "//:tsconfig",
        deps = deps or [],
        **kwargs
    )
