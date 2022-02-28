package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/esbuild:index.bzl", "esbuild")
load("@npm//@bazel/typescript:index.bzl", "ts_project")

esbuild(
    name = "data_fetcher_worker",
    config = "//java/org/trailcatalog/client:esbuild_config",
    entry_point = "data_fetcher.ts",
    link_workspace_root = True,
    sourcemap = "both",
    target = "es2020",
    deps = [
        ":ts",
        "@npm//esbuild",
    ],
)

esbuild(
    name = "tile_fetcher_worker",
    config = "//java/org/trailcatalog/client:esbuild_config",
    entry_point = "tile_fetcher.ts",
    link_workspace_root = True,
    sourcemap = "both",
    target = "es2020",
    deps = [
        ":ts",
        "@npm//esbuild",
    ],
)

ts_project(
    name = "ts",
    srcs = glob(["*.ts"]),
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        "//java/org/trailcatalog/client/models",
        "//java/org/trailcatalog/s2",
    ],
)
