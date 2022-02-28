package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/typescript:index.bzl", "ts_project")

ts_project(
    name = "models",
    srcs = glob(["*.ts"], exclude=["*.test.ts"]),
    allow_js = True,
    declaration = True,
    link_workspace_root = True,
    tsconfig = "//:tsconfig",
    deps = [
        "//java/org/trailcatalog/s2",
    ],
)

