package(default_visibility = [":internal"])

load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")

package_group(
    name = "internal",
    packages = [
        "//java/lat/trails/...",
        "//javatests/lat/trails/...",
        "//production/...",
    ],
)

java_binary(
    name = "api_server",
    main_class = "lat.trails.ApiServerKt",
    runtime_deps = [":api_server_lib"],
)

kt_jvm_library(
    name = "api_server_lib",
    srcs = glob(["*.kt"]),
    deps = [
        "//java/lat/trails/common",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/s2:s2-kt",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:io_javalin_javalin",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
