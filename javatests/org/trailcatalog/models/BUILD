package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "models",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.models.CategoriesTest",
    deps = [
        "//java/org/trailcatalog/models",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
