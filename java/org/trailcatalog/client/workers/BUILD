package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild")
load("@npm//@bazel/typescript:index.bzl", "ts_project")

esbuild(
    name = "fetcher_worker",
    config = "//java/org/trailcatalog/client:esbuild_config",
    entry_point = "fetcher.ts",
    link_workspace_root = True,
    sourcemap = "both",
    target = "es2020",
    deps = [
        ":fetcher_ts",
        "@npm//esbuild",
    ],
)

ts_project(
    name = "fetcher_ts",
    srcs = ["fetcher.ts"],
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        "//java/org/trailcatalog/client:support",
        "//java/org/trailcatalog/s2",
    ],
)
