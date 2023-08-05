package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "public_access",
    main_class = "lat.trails.importers.PublicAccessKt",
    runtime_deps = [":importers"],
)

kt_jvm_library(
    name = "importers",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog/flags",
        "@maven//:mil_nga_geopackage_geopackage",
        "@maven//:mil_nga_tiff",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
