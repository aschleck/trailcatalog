load("@rules_java//java:defs.bzl", "java_binary")
load("@rules_kotlin//kotlin:jvm.bzl", "kt_jvm_library")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//:pkg.bzl", "pkg_tar")

package(default_visibility = ["//java/org/trailcatalog:internal"])

java_binary(
    name = "aviation_vectors",
    main_class = "lat.trails.importers.AviationVectorsKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "conditions",
    main_class = "lat.trails.importers.ConditionsKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "european_designated_areas",
    main_class = "lat.trails.importers.EuropeanDesignatedAreasKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "japan_national_parks",
    main_class = "lat.trails.importers.JapanNationalParksKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "public_access",
    main_class = "lat.trails.importers.PublicAccessKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "snodas",
    main_class = "lat.trails.importers.SnodasKt",
    runtime_deps = [":importers"],
)

java_binary(
    name = "weather",
    main_class = "lat.trails.importers.WeatherKt",
    runtime_deps = [":importers"],
)

pkg_tar(
    name = "aviation_vectors_tar",
    srcs = [":aviation_vectors_deploy.jar"],
    include_runfiles = True,
    strip_prefix = ".",
)

oci_image(
    name = "aviation_vectors_container",
    base = "@distroless_java_linux_amd64",
    entrypoint = [
        "java",
        "-jar",
        "aviation_vectors_deploy.jar",
    ],
    tars = [":aviation_vectors_tar"],
)

oci_load(
    name = "aviation_vectors_container_load",
    image = ":aviation_vectors_container",
    repo_tags = ["latest"],
)

oci_push(
    name = "aviation_vectors_container_push",
    image = ":aviation_vectors_container",
    remote_tags = ["latest"],
    repository = "us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_aviation_vectors",
)

pkg_tar(
    name = "conditions_tar",
    srcs = [":conditions_deploy.jar"],
    include_runfiles = True,
    strip_prefix = ".",
)

oci_image(
    name = "conditions_container",
    base = "@distroless_java_linux_amd64",
    entrypoint = [
        "java",
        "-jar",
        "conditions_deploy.jar",
    ],
    tars = [":conditions_tar"],
)

oci_load(
    name = "conditions_container_load",
    image = ":conditions_container",
    repo_tags = ["latest"],
)

oci_push(
    name = "conditions_container_push",
    image = ":conditions_container",
    remote_tags = ["latest"],
    repository = "us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_conditions",
)

pkg_tar(
    name = "snodas_tar",
    srcs = [":snodas_deploy.jar"],
    include_runfiles = True,
    strip_prefix = ".",
)

oci_image(
    name = "snodas_container",
    base = "@distroless_java_linux_amd64",
    entrypoint = [
        "java",
        "-jar",
        "snodas_deploy.jar",
    ],
    tars = [":snodas_tar"],
)

oci_load(
    name = "snodas_container_load",
    image = ":snodas_container",
    repo_tags = ["latest"],
)

oci_push(
    name = "snodas_container_push",
    image = ":snodas_container",
    remote_tags = ["latest"],
    repository = "us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_snodas",
)

pkg_tar(
    name = "weather_tar",
    srcs = [":weather_deploy.jar"],
    include_runfiles = True,
    strip_prefix = ".",
)

oci_image(
    name = "weather_container",
    base = "@distroless_java_linux_amd64",
    entrypoint = [
        "java",
        "-jar",
        "weather_deploy.jar",
    ],
    tars = [":weather_tar"],
)

oci_load(
    name = "weather_container_load",
    image = ":weather_container",
    repo_tags = ["latest"],
)

oci_push(
    name = "weather_container_push",
    image = ":weather_container",
    remote_tags = ["latest"],
    repository = "us-west1-docker.pkg.dev/trailcatalog/containers/lat_trails_weather",
)

kt_jvm_library(
    name = "importers",
    srcs = glob(["*.kt"]),
    runtime_deps = [
        "@maven//:edu_ucar_unidata_libaec_native",
    ],
    deps = [
        "//java/lat/trails/common",
        "//java/org/trailcatalog/common",
        "//java/org/trailcatalog/flags",
        "//java/org/trailcatalog/importers/basemap",
        "//java/org/trailcatalog/importers/elevation/contour",
        "@com_google_geometry_s2//:s2",
        "@maven//:com_github_usefulness_webp_imageio",
        "@maven//:com_fasterxml_jackson_core_jackson_databind",
        "@maven//:edu_ucar_cdm_core",
        "@maven//:edu_ucar_grib",
        "@maven//:mil_nga_geopackage_geopackage",
        "@maven//:mil_nga_sf",
        "@maven//:mil_nga_tiff",
        "@maven//:org_jetbrains_kotlin_kotlin_stdlib_jdk8",
        "@maven//:org_locationtech_proj4j_proj4j_epsg",
        "@maven//:org_postgresql_postgresql",
        "@maven//:org_slf4j_slf4j_simple",
    ],
)
