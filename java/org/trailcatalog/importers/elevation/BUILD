package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

kt_jvm_library(
    name = "elevation",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_sejda_imageio_webp_imageio",
    ],
    deps = [
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/importers/elevation/pmtiles",
        "//java/org/trailcatalog/importers/elevation/tiff",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_google_guava_guava",
        "@maven//:com_squareup_okhttp3_okhttp_jvm",
    ],
)
