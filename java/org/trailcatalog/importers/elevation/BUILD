package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "elevation",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/importers/elevation/tiff",
        "//java/org/trailcatalog/s2:s2-kt",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:mil_nga_tiff",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
