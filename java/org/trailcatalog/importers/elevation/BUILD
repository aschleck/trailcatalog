package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_docker//container:push.bzl", "container_push")
load("@io_bazel_rules_docker//java:image.bzl", "java_image")
load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

java_binary(
    name = "leveler",
    main_class = "org.trailcatalog.importers.elevation.LevelerKt",
    runtime_deps = [":elevation"],
)

java_image(
    name = "container",
    base = "@container_java_17//image",
    main_class = "org.trailcatalog.importers.elevation.LevelerKt",
    runtime_deps = [":elevation"],
)

container_push(
    name = "container_push",
    format = "OCI",
    image = ":container",
    registry = "us-west1-docker.pkg.dev",
    repository = "trailcatalog/containers/leveler",
    tag = "latest",
)

kt_jvm_library(
    name = "elevation",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
    ],
    deps = [
        "//java/org/trailcatalog:pg_support",
        "//java/org/trailcatalog/importers/basemap",
        "//java/org/trailcatalog/importers/common",
        "//java/org/trailcatalog/importers/elevation/tiff",
        "//java/org/trailcatalog/importers/pbf",
        "//java/org/trailcatalog/s2:s2-kt",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:mil_nga_tiff",
        "@maven//:org_locationtech_proj4j_proj4j",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
