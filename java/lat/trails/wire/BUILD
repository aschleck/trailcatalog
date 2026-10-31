package(default_visibility = ["//java/lat/trails:internal"])

load("//build_defs:ts.bzl", "tc_ts_project")
load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "wire",
    srcs = glob(["*.kt"], exclude=["ToTypeScript.kt"]),
)

tc_ts_project(
    name = "wire-ts",
    srcs = [":to_ts"],
    visibility = ["//java/lat/trails:internal", "//js/map/workers:__pkg__"],
)

genrule(
    name = "to_ts",
    cmd = "$(location :generator_to_ts) > \"$@\"",
    outs = ["wire.ts"],
    tools = [":generator_to_ts"],
)

java_binary(
    name = "generator_to_ts",
    main_class = "lat.trails.wire.ToTypeScriptKt",
    runtime_deps = [":generator_to_ts_lib"],
)

kt_jvm_library(
    name = "generator_to_ts_lib",
    srcs = ["ToTypeScript.kt"],
    deps = [
        ":wire",
    ],
)
