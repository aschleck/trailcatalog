load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
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
        config = ":" + name + "/esbuild.config.mjs",
        entry_point = entry_point,
        tsconfig = "//:tsconfig",
        srcs = [
            entry_point,
        ],
        deps = (css_deps or []) + (deps or []) + [
            ":" + name + "_esbuild_config",
        ],
        minify = minify,
        output_css = "%s.css" % name if has_css else None,
        platform = platform,
        sources_content = True,
        target = "es2020",
    )

    esbuild(
        name = name + "_esbuild_config",
        entry_point = name + "/esbuild.config.mjs",
        format = "esm",
        platform = "node",
        target = "esnext",
        tsconfig = "//:tsconfig",
        srcs = [":" + name + "_esbuild_config_copy"],
        deps = [
            "//:node_modules/autoprefixer",
            "//:node_modules/tailwindcss",
            "//third_party/deanc-esbuild-plugin-postcss",
        ],
    )

    native.genrule(
        name = name + "_esbuild_config_copy",
        srcs = [
            "//build_defs:esbuild.config.mjs",
            "//build_defs:postcss.config.mjs",
            "//build_defs:tailwind.config.mjs",
        ],
        outs = [
            name + "/esbuild.config.mjs",
            name + "/postcss.config.mjs",
            name + "/tailwind.config.mjs",
        ],
        cmd = "\n".join([
            "mkdir -p \"$(@D)/" + name + "\"",
            "for i in $(SRCS); do",
            "  cp \"$${i}\" \"$(@D)/" + name + "/$$(basename \"$${i}\")\"",
            "done",
        ]),
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
        deps = deps or [],
        tsconfig = "//:tsconfig",
        **kwargs
    )

