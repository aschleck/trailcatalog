load("@protobuf//bazel:java_proto_library.bzl", "java_proto_library")
load("@protobuf//bazel:proto_library.bzl", "proto_library")

package(default_visibility = ["//java/org/trailcatalog:internal"])

proto_library(
    name = "encoding_proto",
    srcs = ["encoding.proto"],
)

java_proto_library(
    name = "encoding_java_proto",
    deps = [":encoding_proto"],
)
