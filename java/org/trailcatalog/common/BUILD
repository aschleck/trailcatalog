package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    deps = [
        "@maven//:com_google_guava_guava",
    ],
)
