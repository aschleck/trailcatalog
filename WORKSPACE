workspace(name = "trailcatalog")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "d378df503b8441457851d252dc39b1ed1d8f78abf2247d69abf21b410a256bc6",
    strip_prefix = "rules_nodejs-ad70bee8bfd142348853d5cd91dfc04c3acbd4cb",
    urls = ["https://github.com/bazelbuild/rules_nodejs/archive/ad70bee8bfd142348853d5cd91dfc04c3acbd4cb.zip"],
)

load("@build_bazel_rules_nodejs//:repositories.bzl", "build_bazel_rules_nodejs_dependencies")

build_bazel_rules_nodejs_dependencies()

load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories")

node_repositories()

load("@build_bazel_rules_nodejs//:index.bzl", "yarn_install")

yarn_install(
    name = "npm",
    exports_directories_only = False,
    package_json = "//:package.json",
    yarn_lock = "//:yarn.lock",
)

load("@build_bazel_rules_nodejs//toolchains/esbuild:esbuild_repositories.bzl", "esbuild_repositories")

esbuild_repositories(npm_repository = "npm")

# TODO: remove after https://github.com/bazelbuild/rules_nodejs/pull/3414
http_archive(
    name = "io_bazel_rules_webtesting",
    sha256 = "5dc7796a03172f4949c734a4a9c685cc3c11511ffa49036ca8f979c06d177d9f",
    strip_prefix = "rules_webtesting-c241fb5b46f2d1c408f3446b9f2ada773acb6716",
    urls = [
        "https://github.com/bazelbuild/rules_webtesting/archive/c241fb5b46f2d1c408f3446b9f2ada773acb6716.zip",
    ],
)

RULES_JVM_EXTERNAL_VERSION = "d6884e66411033794a8f7137864e07143eb6814f"

RULES_JVM_EXTERNAL_SHA = "0c21581c8251aff1e894e6998eca8fbc869886ff801f11fb2ff4463dce10c0d9"

http_archive(
    name = "rules_jvm_external",
    sha256 = RULES_JVM_EXTERNAL_SHA,
    strip_prefix = "rules_jvm_external-%s" % RULES_JVM_EXTERNAL_VERSION,
    url = "https://github.com/bazelbuild/rules_jvm_external/archive/%s.zip" % RULES_JVM_EXTERNAL_VERSION,
)

load("@rules_jvm_external//:repositories.bzl", "rules_jvm_external_deps")

rules_jvm_external_deps()

load("@rules_jvm_external//:setup.bzl", "rules_jvm_external_setup")

rules_jvm_external_setup()

http_archive(
    name = "rules_proto",
    sha256 = "66bfdf8782796239d3875d37e7de19b1d94301e8972b3cbd2446b332429b4df1",
    strip_prefix = "rules_proto-4.0.0",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_proto/archive/refs/tags/4.0.0.tar.gz",
        "https://github.com/bazelbuild/rules_proto/archive/refs/tags/4.0.0.tar.gz",
    ],
)

load("@rules_proto//proto:repositories.bzl", "rules_proto_dependencies", "rules_proto_toolchains")

rules_proto_dependencies()

rules_proto_toolchains()

RULES_KOTLIN_VERSION = "v1.6.0"

load("@rules_jvm_external//:defs.bzl", "maven_install")

http_archive(
    name = "io_bazel_rules_kotlin",
    sha256 = "a57591404423a52bd6b18ebba7979e8cd2243534736c5c94d35c89718ea38f94",
    urls = ["https://github.com/bazelbuild/rules_kotlin/releases/download/%s/rules_kotlin_release.tgz" % RULES_KOTLIN_VERSION],
)

load("@io_bazel_rules_kotlin//kotlin:repositories.bzl", "kotlin_repositories")

kotlin_repositories()

load("@io_bazel_rules_kotlin//kotlin:core.bzl", "kt_register_toolchains")

kt_register_toolchains()

maven_install(
    artifacts = [
        "args4j:args4j:2.33",
        "com.google.code.gson:gson:2.8.9",
        "org.apache.commons:commons-text:1.9",
        "com.fasterxml.jackson.core:jackson-databind:2.13.3",
        "com.google.geometry:s2-geometry:2.0.0",
        "com.google.guava:guava:31.1-jre",
        "com.google.guava:guava-gwt:31.1-jre",
        "com.google.javascript:closure-compiler-unshaded:jar:v20220905",
        "com.google.truth:truth:1.1.3",
        "com.google.truth.extensions:truth-java8-extension:1.1.3",
        "com.squareup.okhttp3:okhttp:4.9.0",
        "com.wolt.osm:parallelpbf:0.3.1",
        "com.zaxxer:HikariCP:5.0.1",
        "io.javalin:javalin:4.6.3",
        "mil.nga:tiff:3.0.0",
        "org.apache.commons:commons-text:jar:1.9",
        "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.21",
        "org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.6.1",
        "org.junit.jupiter:junit-jupiter:5.8.2",
        "org.locationtech.proj4j:proj4j:1.1.5",
        "org.postgresql:postgresql:42.3.1",
        "org.slf4j:slf4j-simple:2.0.0",
    ],
    repositories = [
        "https://repo1.maven.org/maven2",
    ],
)

http_archive(
    name = "io_bazel_rules_closure",
    sha256 = "c4b3c84c908891a91a7ad4f17cb685167042795f72d0d5b7ba364bbb7850cc98",
    strip_prefix = "rules_closure-d01ed25111e00e4e488db6a9213965df81b5b1ef",
    urls = ["https://github.com/bazelbuild/rules_closure/archive/d01ed25111e00e4e488db6a9213965df81b5b1ef.zip"],
)

load("@io_bazel_rules_closure//closure:repositories.bzl", "rules_closure_dependencies", "rules_closure_toolchains")

rules_closure_dependencies(
    omit_com_google_auto_common = True,
)

rules_closure_toolchains()

local_repository(
    name = "com_google_j2cl",
    path = "../j2cl",
)

load("@com_google_j2cl//build_defs:repository.bzl", "load_j2cl_repo_deps")

load_j2cl_repo_deps()

load("@com_google_j2cl//build_defs:rules.bzl", "j2cl_maven_import_external", "setup_j2cl_workspace")

setup_j2cl_workspace(omit_kotlin = True)

http_archive(
    name = "com_google_elemental2",
    sha256 = "35c1900143297a7ef96f8ea1e38c687e5592ea69e973b15030e01c9f8c839d7c",
    strip_prefix = "elemental2-d5a43d684efb6acc5e8e805df2db7e5050f7dcea",
    url = "https://github.com/google/elemental2/archive/d5a43d684efb6acc5e8e805df2db7e5050f7dcea.zip",
)

load("@com_google_elemental2//build_defs:repository.bzl", "load_elemental2_repo_deps")

load_elemental2_repo_deps()

load("@com_google_elemental2//build_defs:workspace.bzl", "setup_elemental2_workspace")

setup_elemental2_workspace()

j2cl_maven_import_external(
    name = "com_google_code_findbugs_jsr305-j2cl",
    annotation_only = True,
    artifact = "com.google.code.findbugs:jsr305:3.0.2",
    server_urls = ["https://repo1.maven.org/maven2/"],
)

j2cl_maven_import_external(
    name = "com_google_errorprone_error_prone_annotations-j2cl",
    annotation_only = True,
    artifact = "com.google.errorprone:error_prone_annotations:2.11.0",
    artifact_sha256 = "721cb91842b46fa056847d104d5225c8b8e1e8b62263b993051e1e5a0137b7ec",
    server_urls = ["https://repo1.maven.org/maven2/"],
)

j2cl_maven_import_external(
    name = "com_google_j2objc_annotations-j2cl",
    annotation_only = True,
    artifact = "com.google.j2objc:j2objc-annotations:jar:1.3",
    artifact_sha256 = "21af30c92267bd6122c0e0b4d20cccb6641a37eaf956c6540ec471d584e64a7b",
    server_urls = ["https://repo1.maven.org/maven2/"],
)

j2cl_maven_import_external(
    name = "org_checkerframework_checker_qual-j2cl",
    annotation_only = True,
    artifact = "org.checkerframework:checker-qual:3.21.2",
    artifact_sha256 = "7e8554c902b9b839e61396cfe3a64c84ecabfb8eb652c410bfd8e4f5c1a8ece8",
    server_urls = ["https://repo1.maven.org/maven2/"],
)

j2cl_maven_import_external(
    name = "com_google_guava-j2cl",
    artifact = "com.google.guava:guava-gwt:31.0.1-jre",
    artifact_sha256 = "63c378abce1dc1de39312630630ee68b1578350af5907eab995833a0ba03ed35",
    server_urls = ["https://repo1.maven.org/maven2/"],
    deps = [
        "@com_google_code_findbugs_jsr305-j2cl",
        "@com_google_elemental2//:elemental2-promise-j2cl",
        "@com_google_errorprone_error_prone_annotations-j2cl",
        "@com_google_j2cl//:jsinterop-annotations-j2cl",
        "@com_google_j2objc_annotations-j2cl",
        "@org_checkerframework_checker_qual-j2cl",
    ],
)

local_repository(
    name = "com_google_geometry_s2",
    path = "../s2-geometry-library-java",
)

http_archive(
    name = "rules_pkg",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_pkg/releases/download/0.7.1/rules_pkg-0.7.1.tar.gz",
        "https://github.com/bazelbuild/rules_pkg/releases/download/0.7.1/rules_pkg-0.7.1.tar.gz",
    ],
    sha256 = "451e08a4d78988c06fa3f9306ec813b836b1d076d0f055595444ba4ff22b867f",
)

load("@rules_pkg//:deps.bzl", "rules_pkg_dependencies")

rules_pkg_dependencies()

http_archive(
    name = "io_bazel_rules_docker",
    sha256 = "b1e80761a8a8243d03ebca8845e9cc1ba6c82ce7c5179ce2b295cd36f7e394bf",
    urls = ["https://github.com/bazelbuild/rules_docker/releases/download/v0.25.0/rules_docker-v0.25.0.tar.gz"],
)

load("@io_bazel_rules_docker//repositories:repositories.bzl", container_repositories = "repositories")

container_repositories()

load("@io_bazel_rules_docker//java:image.bzl", _java_image_repos = "repositories")

_java_image_repos()

load("@io_bazel_rules_docker//container:pull.bzl", "container_pull")

container_pull(
    name = "container_java_17",
    registry = "gcr.io",
    repository = "distroless/java17",
    tag = "latest",
)
