package(default_visibility = ["//java/org/trailcatalog:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "models",
    srcs = glob(["*.kt"], exclude=["ToTypeScript.kt"]),
)

tc_ts_project(
    name = "models-ts",
    srcs = [":to_ts"],
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

