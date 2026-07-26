load("@protobuf//bazel:java_proto_library.bzl", "java_proto_library")
load("@protobuf//bazel:proto_library.bzl", "proto_library")

package(default_visibility = ["//visibility:public"])

proto_library(
    name = "vector_tile_proto",
    srcs = ["vector_tile.proto"],
)

java_proto_library(
    name = "vector_tile_java_proto",
    deps = [":vector_tile_proto"],
)
