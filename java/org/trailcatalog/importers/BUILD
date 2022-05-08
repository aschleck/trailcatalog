package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "importer",
    main_class = "org.trailcatalog.importers.ImporterKt",
    runtime_deps = [":import_lib"],
)

kt_jvm_library(
    name = "import_lib",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/pbf",
        "//java/org/trailcatalog/s2:s2-java",
        "//trailcatalog/proto:encoding_java_proto",
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_squareup_okhttp3_okhttp",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_jetbrains_kotlinx_kotlinx_coroutines_core_jvm",
        "@maven//:org_postgresql_postgresql",
    ],
)
