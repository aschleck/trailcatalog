package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "pipeline",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/importers/pipeline/collections",
        "@maven//:com_google_guava_guava",
    ],
)
