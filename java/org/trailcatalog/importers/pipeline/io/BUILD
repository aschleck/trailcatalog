package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "io",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/common",
        "@maven//:com_google_guava_guava",
    ],
)
