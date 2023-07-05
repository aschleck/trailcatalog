package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "flags",
    srcs = glob(["*.kt"]),
    deps = [
        "@maven//:com_google_guava_guava",
        "@maven//:org_reflections_reflections",
    ],
)
