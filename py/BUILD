package(default_visibility = ["//visibility:private"])

load("@io_bazel_rules_docker//container:push.bzl", "container_push")
load("@io_bazel_rules_docker//python3:image.bzl", "py3_image")
load("@rules_python//python:defs.bzl", "py_binary")

py_binary(
    name = "svgs_to_atlas",
    srcs = ["svgs_to_atlas.py"],
    deps = [
        "@pip_reportlab//:pkg",
        "@pip_svgutils//:pkg",
    ],
)

py_binary(
    name = "planet_update",
    srcs = ["planet_update.py"],
    deps = [
        "@pip_osmium//:pkg",
    ],
)

py3_image(
    name = "planet_update_container",
    main = "planet_update.py",
    srcs = ["planet_update.py"],
    deps = [":planet_update"],
)

container_push(
    name = "planet_update_container_push",
    format = "OCI",
    image = ":planet_update_container",
    registry = "us-west1-docker.pkg.dev",
    repository = "trailcatalog/containers/planet_update",
    tag = "latest",
)
