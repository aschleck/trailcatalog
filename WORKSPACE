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
    sha256 = "b474bbf688f8019d76c1f4701960329a09fb6d5efeb42862118f8f16d1c7718b",
    strip_prefix = "rules_nodejs-af6266e9fb489386e766c57a0bc485ca976ca4f4",
    urls = ["https://github.com/bazelbuild/rules_nodejs/archive/af6266e9fb489386e766c57a0bc485ca976ca4f4.zip"],
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

RULES_JVM_EXTERNAL_TAG = "4.2"

RULES_JVM_EXTERNAL_SHA = "cd1a77b7b02e8e008439ca76fd34f5b07aecb8c752961f9640dea15e9e5ba1ca"

http_archive(
    name = "rules_jvm_external",
    sha256 = RULES_JVM_EXTERNAL_SHA,
    strip_prefix = "rules_jvm_external-%s" % RULES_JVM_EXTERNAL_TAG,
    url = "https://github.com/bazelbuild/rules_jvm_external/archive/%s.zip" % RULES_JVM_EXTERNAL_TAG,
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

rules_kotlin_version = "v1.5.0"

load("@rules_jvm_external//:defs.bzl", "maven_install")

http_archive(
    name = "io_bazel_rules_kotlin",
    sha256 = "12d22a3d9cbcf00f2e2d8f0683ba87d3823cb8c7f6837568dd7e48846e023307",
    urls = ["https://github.com/bazelbuild/rules_kotlin/releases/download/%s/rules_kotlin_release.tgz" % rules_kotlin_version],
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
        "com.google.geometry:s2-geometry:2.0.0",
        "com.google.guava:guava:31.1-jre",
        "com.google.guava:guava-gwt:31.1-jre",
        "com.google.javascript:closure-compiler-unshaded:jar:v20220104",
        "com.google.truth:truth:1.1.3",
        "com.google.truth.extensions:truth-java8-extension:1.1.3",
        "com.wolt.osm:parallelpbf:0.3.1",
        "com.zaxxer:HikariCP:5.0.1",
        "io.javalin:javalin:4.3.0",
        "org.apache.commons:commons-text:jar:1.9",
        "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.21",
        "org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.6.1",
        "org.junit.jupiter:junit-jupiter:5.8.2",
        "org.postgresql:postgresql:42.3.1",
        "org.slf4j:slf4j-simple:1.8.0-beta4",
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
    sha256 = "0aaf2ccb9a8d8ef9fcc8d3f0f9c336530097c8a5bc8ba6502808b98df702fbdd",
    strip_prefix = "elemental2-f8586086f47c82385036bc7974580d59f4721d6a",
    url = "https://github.com/google/elemental2/archive/f8586086f47c82385036bc7974580d59f4721d6a.zip",
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
