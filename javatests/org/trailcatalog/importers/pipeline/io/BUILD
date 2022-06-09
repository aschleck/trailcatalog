package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@io_bazel_rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "io",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pipeline.io.EncodedStreamsTest",
    deps = [
        "//java/org/trailcatalog/importers/pipeline/io",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
