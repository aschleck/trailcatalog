load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

package(default_visibility = ["//java/org/trailcatalog:internal"])

kt_jvm_library(
    name = "common",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/common",
        "@maven//:com_google_guava_guava",
        "@maven//:com_squareup_okhttp3_okhttp_jvm",
        "@maven//:org_postgresql_postgresql",
    ],
)
