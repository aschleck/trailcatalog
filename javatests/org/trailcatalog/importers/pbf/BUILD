package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "pbf",
    srcs = glob(["*.kt"]),
    test_class = "org.trailcatalog.importers.pbf.ExtractRelationsTest",
    deps = [
        "//java/org/trailcatalog/importers/pbf",
        "//java/org/trailcatalog/importers/pbf:pbf_java",
        "@maven//:com_google_protobuf_protobuf_java",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
        "@osmpbf//osmpbf:java_proto",
    ],
)
