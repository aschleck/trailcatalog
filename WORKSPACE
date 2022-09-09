workspace(name = "trailcatalog")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "io_bazel_rules_go",
    sha256 = "d6b2513456fe2229811da7eb67a444be7785f5323c6708b38d851d2b51e54d83",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_go/releases/download/v0.30.0/rules_go-v0.30.0.zip",
        "https://github.com/bazelbuild/rules_go/releases/download/v0.30.0/rules_go-v0.30.0.zip",
    ],
)

load("@io_bazel_rules_go//go:deps.bzl", "go_register_toolchains", "go_rules_dependencies")

go_rules_dependencies()

go_register_toolchains(version = "1.17.6")

http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "2ef61a8d4a80ea244ddc8ef82641ea111f8e7d37acbf9e5af9d23aeb21f32e6f",
    strip_prefix = "rules_nodejs-1074231da3bd390a3ae600f8892da05bef3b6939",
    urls = ["https://github.com/bazelbuild/rules_nodejs/archive/1074231da3bd390a3ae600f8892da05bef3b6939.zip"],
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

http_archive(
    name = "io_bazel_rules_webtesting",
    sha256 = "843d93b49cb404152114b3e08f98584f2ca1b102fc5a432918ae8eee6309963d",
    strip_prefix = "rules_webtesting-e9cf17123068b1123c68219edf9b274bf057b9cc",
    urls = [
        "https://github.com/bazelbuild/rules_webtesting/archive/e9cf17123068b1123c68219edf9b274bf057b9cc.zip",
    ],
)

http_archive(
    name = "io_bazel_stardoc",
    sha256 = "c0b2f66b220e6741dffaaa49e709490026dbb5519d335628621f4f9266e79dd8",
    strip_prefix = "stardoc-0.5.0",
    url = "https://github.com/bazelbuild/stardoc/archive/refs/tags/0.5.0.zip",
)

RULES_JVM_EXTERNAL_VERSION = "6c325c279ab6906265d0ae2b4dd1871df3cad37f"

RULES_JVM_EXTERNAL_SHA = "fb71346651d9d3b1cd025d79e2d202c18e723f6953174e432e1f4e210beb8780"

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

RULES_KOTLIN_VERSION = "1.6.0-RC-1"

load("@rules_jvm_external//:defs.bzl", "maven_install")

http_archive(
    name = "io_bazel_rules_kotlin",
    sha256 = "f1a4053eae0ea381147f5056bb51e396c5c494c7f8d50d0dee4cc2f9d5c701b0",
    urls = ["https://github.com/bazelbuild/rules_kotlin/releases/download/%s/rules_kotlin_release.tgz" % RULES_KOTLIN_VERSION],
)

load("@io_bazel_rules_kotlin//kotlin:repositories.bzl", "kotlin_repositories", "versions")

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
        "com.google.javascript:closure-compiler-unshaded:jar:v20220104",
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
    sha256 = "486754baa3659663c96fd788b299946df9344bd86d43945710eaa649b68f48e6",
    strip_prefix = "rules_closure-b5ca4055703da019b345a659a4f57a62c11c780a",
    urls = ["https://github.com/bazelbuild/rules_closure/archive/b5ca4055703da019b345a659a4f57a62c11c780a.zip"],
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

setup_j2cl_workspace()

http_archive(
    name = "com_google_elemental2",
    sha256 = "1bff8487e2a0425c7a80e9f793dc8e7c11ed1ca69750ccab2c0b3196dedd40e2",
    strip_prefix = "elemental2-7572ef9de9406c19998b51ae829c0fc91a551bd0",
    url = "https://github.com/google/elemental2/archive/7572ef9de9406c19998b51ae829c0fc91a551bd0.zip",
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
    sha256 = "8a298e832762eda1830597d64fe7db58178aa84cd5926d76d5b744d6558941c2",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_pkg/releases/download/0.7.0/rules_pkg-0.7.0.tar.gz",
        "https://github.com/bazelbuild/rules_pkg/releases/download/0.7.0/rules_pkg-0.7.0.tar.gz",
    ],
)

load("@rules_pkg//:deps.bzl", "rules_pkg_dependencies")

rules_pkg_dependencies()
