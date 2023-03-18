package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "tiff",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/importers/pipeline/io",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_google_guava_guava",
        "@maven//:mil_nga_tiff",
        "@maven//:org_locationtech_proj4j_proj4j",
    ],
)
