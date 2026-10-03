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

kt_jvm_test(
    name = "parallelism",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pipeline.ParallelismTest",
    deps = [
        "//java/org/trailcatalog/importers/pipeline",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)

kt_jvm_test(
    name = "streaming_merge",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pipeline.StreamingMergeTest",
    deps = [
        "//java/org/trailcatalog/importers/pipeline",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)

kt_jvm_test(
    name = "partition",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pipeline.PartitionTest",
    deps = [
        "//java/org/trailcatalog/importers/pipeline",
        "//java/org/trailcatalog/importers/pipeline/collections",
        "@maven//:com_google_guava_guava",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
