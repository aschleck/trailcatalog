package(default_visibility = [":internal"])

load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files", "strip_prefix")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

package_group(
    name = "internal",
    packages = [
        "//java/lat/trails/...",
        "//javatests/lat/trails/...",
        "//production/...",
    ],
)

pkg_tar(
    name = "frontend_pkg",
    package_dir = "app",
    srcs = [
        "//java/lat/trails/frontend:frontend.js",
        "//java/lat/trails/frontend:frontend.js.map",
        ":api_server_deploy.jar",
        ":static_data",
    ],
    stamp = 1,
)

pkg_files(
    name = "static_data",
    srcs = [
        "//java/lat/trails/static",
    ],
    prefix = "static",
    strip_prefix = strip_prefix.from_pkg(),
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
        "@com_google_geometry_s2//:s2",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:io_javalin_javalin",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
