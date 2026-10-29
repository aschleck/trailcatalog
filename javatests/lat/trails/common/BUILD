load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "bounds",
    srcs = ["BoundsTest.kt"],
    test_class = "lat.trails.common.BoundsTest",
    deps = [
        "//java/lat/trails/common",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)

kt_jvm_test(
    name = "common",
    srcs = ["PolygonsTest.kt"],
    test_class = "lat.trails.common.PolygonsTest",
    deps = [
        "//java/lat/trails/common",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
