load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

package(default_visibility = ["//java/org/trailcatalog:internal"])

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/flags",
        "@maven//:com_google_guava_guava",
    ],
)
