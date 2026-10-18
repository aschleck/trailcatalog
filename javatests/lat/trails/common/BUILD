load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "common",
    srcs = glob(["*.kt"]),
    test_class = "lat.trails.common.PolygonsTest",
    deps = [
        "//java/lat/trails/common",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
