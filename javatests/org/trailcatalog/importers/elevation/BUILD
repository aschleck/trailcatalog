package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "mapterhorn_resolver",
    srcs = [
        "Archives.kt",
        "MapterhornResolverTest.kt",
    ],
    test_class = "org.trailcatalog.importers.elevation.MapterhornResolverTest",
    deps = [
        "//java/org/trailcatalog/importers/elevation",
        "//java/org/trailcatalog/importers/elevation/pmtiles",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)

kt_jvm_test(
    name = "pmtiles_reader",
    srcs = [
        "Archives.kt",
        "PmtilesReaderTest.kt",
    ],
    test_class = "org.trailcatalog.importers.elevation.PmtilesReaderTest",
    deps = [
        "//java/org/trailcatalog/importers/elevation/pmtiles",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
