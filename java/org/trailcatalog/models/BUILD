package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@npm//@bazel/typescript:index.bzl", "ts_project")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

kt_jvm_library(
    name = "models",
    srcs = glob(["*.kt"], exclude=["ToTypeScript.kt"]),
)

ts_project(
    name = "models-ts",
    srcs = [":to_ts"],
    allow_js = True,
    declaration = True,
    preserve_jsx = True,
    tsconfig = "//:tsconfig",
)

genrule(
    name = "to_ts",
    cmd = "$(location :generator_to_ts) > \"$@\"",
    outs = ["categories.ts"],
    tools = [":generator_to_ts"],
)

java_binary(
    name = "generator_to_ts",
    main_class = "org.trailcatalog.models.ToTypeScriptKt",
    runtime_deps = [":generator_to_ts_lib"],
)

kt_jvm_library(
    name = "generator_to_ts_lib",
    srcs = ["ToTypeScript.kt"],
    deps = [
        ":models",
    ],
)

