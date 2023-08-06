package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_postgresql_postgresql",
    ],
    deps = [
        "//java/org/trailcatalog/flags",
        "@maven//:com_zaxxer_HikariCP",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
    ],
)
