package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "collections",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/importers/pipeline/io",
        "//java/org/trailcatalog/importers/pipeline/progress",
        "@maven//:com_google_guava_guava",
        "@maven//:com_google_protobuf_protobuf_java",
    ],
)
