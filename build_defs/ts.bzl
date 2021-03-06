load("@build_bazel_rules_nodejs//:index.bzl", "copy_to_bin")
load("@npm//@bazel/esbuild:index.bzl", "esbuild")
load("@npm//@bazel/typescript:index.bzl", "ts_project")
load("@npm//jest-cli:index.bzl", "jest_test")

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
        link_workspace_root = True,
        minify = True,
        output_css = "%s.css" % name if has_css else None,
        platform = platform,
        sources_content = True,
        target = "es2020",
        deps = deps + [
            "@npm//esbuild",
        ],
    )


def tc_ts_project(name, srcs = None, css_deps = None, data = None, deps = None):
    srcs = srcs or native.glob(["*.ts", "*.tsx"], exclude=["*.test.ts"])

    ts_project(
        name = name,
        srcs = srcs,
        allow_js = True,
        declaration = True,
        link_workspace_root = True,
        preserve_jsx = True,
        tsconfig = "//:tsconfig",
        data = data or [],
        deps = deps or [],
    )

    if native.glob(["*.css"]):
        copy_to_bin(
            name = name + "_css",
            srcs = native.glob(["*.css"]),
        )
        native.filegroup(
            name = "css",
            srcs = (css_deps or []) + [
                ":{}_css".format(name),
            ],
        )
    else:
        native.filegroup(
            name = "css",
            data = css_deps or [],
        )

    ts_project(
        name = "tests",
        srcs = native.glob(["*.test.ts"]),
        allow_js = True,
        declaration = True,
        link_workspace_root = True,
        tsconfig = "//:tsconfig",
        deps = [
            ":%s" % name,
            "@npm//@types/jest",
        ],
    )

    jest_test(
        name = "jest",
        data = [
            ":tests",
            "//build_defs:jest.config.js",
        ],
        args = [
            "--node_options=--experimental-vm-modules",
            "--no-cache",
            "--no-watchman",
            "--ci",
            "--colors",
            "--config",
            "jest.config.js",
        ],
    )

