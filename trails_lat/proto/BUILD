load("@aspect_rules_ts//ts:proto.bzl", "ts_proto_library")
load("@protobuf//bazel:java_proto_library.bzl", "java_proto_library")
load("@protobuf//bazel:proto_library.bzl", "proto_library")

package(default_visibility = ["//java/lat/trails:internal"])

proto_library(
    name = "data_proto",
    srcs = ["data.proto"],
)

java_proto_library(
    name = "data_java_proto",
    deps = [":data_proto"],
)

ts_proto_library(
    name = "data_ts_proto",
    copy_files = False,
    gen_connect_es = False,
    node_modules = "//:node_modules",
    proto = ":data_proto",
    proto_srcs = ["data.proto"],
)
