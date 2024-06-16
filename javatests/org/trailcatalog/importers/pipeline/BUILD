package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "pipeline",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pipeline.PipelineTest",
    deps = [
        "//java/org/trailcatalog/importers/pipeline",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
