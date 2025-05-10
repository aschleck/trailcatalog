package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

java_binary(
    name = "public_access",
    main_class = "lat.trails.importers.PublicAccessKt",
    runtime_deps = [":importers"],
)

kt_jvm_library(
    name = "importers",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/lat/trails/common",
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/importers/basemap",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:mil_nga_geopackage_geopackage",
        "@maven//:mil_nga_sf",
        "@maven//:mil_nga_tiff",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_locationtech_proj4j_proj4j_epsg",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
