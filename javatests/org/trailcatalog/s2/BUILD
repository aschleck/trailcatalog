package(default_visibility = ["//java/org/trailcatalog:internal"])

load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "s2",
    srcs = glob(["*.kt"]),
    # cover() signals a wrapped viewport with longitudes past +/-pi, which trips the validity
    # assertions S2 added in 5ec2a61. Production runs through J2CL, which compiles asserts out.
    jvm_flags = ["-da"],
    test_class = "org.trailcatalog.s2.SimpleS2Test",
    deps = [
        "//java/org/trailcatalog/s2:s2-java",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
