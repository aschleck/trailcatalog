package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_docker//container:push.bzl", "container_push")
load("@io_bazel_rules_docker//java:image.bzl", "java_image")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "importer",
    main_class = "org.trailcatalog.importers.ImporterKt",
    runtime_deps = [":import_lib"],
)

java_image(
    name = "container",
    base = "@container_java_17//image",
    main_class = "org.trailcatalog.importers.ImporterKt",
    runtime_deps = [":importer"],
)

container_push(
    name = "container_push",
    format = "OCI",
    image = ":container",
    registry = "us-west1-docker.pkg.dev",
    repository = "trailcatalog/containers/importer",
    tag = "latest",
)

kt_jvm_library(
    name = "import_lib",
    srcs = glob(["*.kt"]),
    deps = [
        ":importer_java",
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/importers/pbf",
        "//java/org/trailcatalog/importers/pbf:pbf_java",
        "//java/org/trailcatalog/importers/pipeline",
        "//java/org/trailcatalog/importers/pipeline/collections",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "//trailcatalog/proto:encoding_java_proto",
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:mil_nga_tiff",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_jetbrains_kotlinx_kotlinx_coroutines_core_jvm",
        "@maven//:org_postgresql_postgresql",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)

java_library(
    name = "importer_java",
    srcs = glob(["*.java"]),
    deps = [
        "//java/org/trailcatalog/importers/pbf:pbf_java",
        "@maven//:com_google_geometry_s2_geometry",
    ],
)
