package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_library")

kt_jvm_library(
    name = "pbf",
    srcs = glob(["*.kt"]),
    deps = [
        ":records",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "//java/org/trailcatalog/s2:s2-kt",
        "//trailcatalog/proto:encoding_java_proto",
        "@maven//:com_google_guava_guava",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:org_apache_commons_commons_text",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk7",
    ],
)

java_library(
    name = "records",
    srcs = glob(["*Record.java"]),
)
