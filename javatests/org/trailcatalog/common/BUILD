package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "delta_lat_lng_e7",
    srcs = ["DeltaLatLngE7Test.kt"],
    test_class = "org.trailcatalog.common.DeltaLatLngE7Test",
    deps = [
        "//java/org/trailcatalog/common",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)

kt_jvm_test(
    name = "delta_int64",
    srcs = ["DeltaInt64Test.kt"],
    test_class = "org.trailcatalog.common.DeltaInt64Test",
    deps = [
        "//java/org/trailcatalog/common",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
