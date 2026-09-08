package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_postgresql_postgresql",
    ],
    deps = [
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/flags",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_zaxxer_HikariCP",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
    ],
)
