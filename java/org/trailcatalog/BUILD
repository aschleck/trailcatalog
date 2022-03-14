package(default_visibility = [":internal"])

load("@build_bazel_rules_nodejs//:index.bzl", "copy_to_bin")
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
        "@maven//:com_zaxxer_HikariCP",
        "@maven//:io_javalin_javalin",
        "@maven//:org_postgresql_postgresql",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)

copy_to_bin(
    name = "assets",
    srcs = glob(["*.html"]),
)

java_binary(
    name = "import_osm",
    main_class = "org.trailcatalog.ImportOsmKt",
    runtime_deps = [":import_lib"],
)

java_binary(
    name = "seed_trails",
    main_class = "org.trailcatalog.SeedTrailsFromOsmKt",
    runtime_deps = [":import_lib"],
)

kt_jvm_library(
    name = "import_lib",
    srcs = [
        "ImportOsm.kt",
        "SeedTrailsFromOsm.kt",
    ],
    data = [
        "washington-latest.osm.pbf",
    ],
    deps = [
        "//java/org/trailcatalog/pbf",
        "//java/org/trailcatalog/s2:s2-java",
        "@bazel_tools//tools/java/runfiles",
        "@maven//:com_google_geometry_s2_geometry",
        "@maven//:com_wolt_osm_parallelpbf",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk7",
        "@maven//:org_postgresql_postgresql",
    ],
)
