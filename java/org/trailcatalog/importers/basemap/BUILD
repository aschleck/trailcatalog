package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_java//java:defs.bzl", "java_binary", "java_library")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//:pkg.bzl", "pkg_tar")

java_binary(
    name = "importer",
    main_class = "org.trailcatalog.importers.basemap.ImporterKt",
    runtime_deps = [":basemap"],
)

pkg_tar(
    name = "tar",
    srcs = [":importer_deploy.jar"],
    include_runfiles = True,
    strip_prefix = ".",
)

oci_image(
    name = "container",
    base = "@distroless_java",
    entrypoint = [
        "java",
        "-jar",
        "importer_deploy.jar",
    ],
    tars = [":tar"],
)

oci_load(
    name = "container_load",
    image = ":container",
    repo_tags = ["latest"],
)

oci_push(
    name = "container_push",
    image = ":container",
    repository = "us-west1-docker.pkg.dev/trailcatalog/containers/importer",
    remote_tags = ["latest"],
)

kt_jvm_library(
    name = "basemap",
    srcs = glob(["*.kt"]),
    deps = [
        ":basemap_java",
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/importers/elevation",
        "//java/org/trailcatalog/importers/pbf",
        "//java/org/trailcatalog/importers/pbf:pbf_java",
        "//java/org/trailcatalog/importers/pipeline",
        "//java/org/trailcatalog/importers/pipeline/collections",
        "//java/org/trailcatalog/models",
        "//java/org/trailcatalog/s2:s2-java",
        "//trailcatalog/proto:encoding_java_proto",
        "@bazel_tools//tools/java/runfiles",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:mil_nga_tiff",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_jetbrains_kotlinx_kotlinx_coroutines_core_jvm",
        "@maven//:org_postgresql_postgresql",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)

java_library(
    name = "basemap_java",
    srcs = glob(["*.java"]),
    deps = [
        "//java/org/trailcatalog/importers/pbf:pbf_java",
        "@com_google_geometry_s2//:s2",
    ],
)
