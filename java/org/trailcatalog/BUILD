package(default_visibility = [":internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_java//java:defs.bzl", "java_binary")

package_group(
    name = "internal",
    packages = [
        "//java/org/trailcatalog/...",
    ],
)

java_binary(
    name = "frontend",
    main_class = "org.trailcatalog.FrontendKt",
    runtime_deps = [":frontend_lib"],
)

kt_jvm_library(
    name = "frontend_lib",
    srcs = ["Frontend.kt"],
    data = [
        ":index.html",
        "//java/org/trailcatalog/static",
    ],
    deps = [
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:io_javalin_javalin",
        "@maven//:org_postgresql_postgresql",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)

java_binary(
    name = "import",
    main_class = "org.trailcatalog.ImportKt",
    runtime_deps = [":import_lib"],
)

kt_jvm_library(
    name = "import_lib",
    srcs = ["Import.kt"],
    deps = [
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:org_postgresql_postgresql",
    ],
)
