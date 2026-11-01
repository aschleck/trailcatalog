load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_test")

kt_jvm_test(
    name = "images",
    srcs = ["ImagesTest.kt"],
    test_class = "lat.trails.ImagesTest",
    deps = [
        "//java/lat/trails:api_server_lib",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:com_google_truth_truth",
        "@maven//:org_junit_jupiter_junit_jupiter",
    ],
)
