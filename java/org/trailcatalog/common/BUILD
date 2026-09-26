load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

package(default_visibility = ["//java/org/trailcatalog:internal"])

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/s2:s2-java",
        "@maven//:com_google_guava_guava",
    ],
)
