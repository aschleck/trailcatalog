package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "scraper",
    main_class = "org.trailcatalog.importers.elevation.metadata.ScraperKt",
    runtime_deps = [":metadata"],
)

kt_jvm_library(
    name = "metadata",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
    ],
    deps = [
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/s2:s2-kt",
        "@maven//:com_google_code_gson_gson",
        "@maven//:com_squareup_okhttp3_okhttp",
        "@maven//:org_postgresql_postgresql",
    ],
)
