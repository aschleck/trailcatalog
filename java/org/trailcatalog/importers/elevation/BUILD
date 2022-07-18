package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "leveler",
    main_class = "org.trailcatalog.importers.elevation.LevelerKt",
    runtime_deps = [":elevation"],
)

kt_jvm_library(
    name = "elevation",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
    ],
    deps = [
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/s2:s2-kt",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:mil_nga_tiff",
        "@maven//:org_locationtech_proj4j_proj4j",
    ],
)
