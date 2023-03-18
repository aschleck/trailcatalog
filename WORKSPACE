workspace(name = "trailcatalog")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "io_tweag_rules_nixpkgs",
    strip_prefix = "rules_nixpkgs-62d63740061dd94ecee3ec2c0cfc8a7ed409b98c",
    urls = ["https://github.com/tweag/rules_nixpkgs/archive/62d63740061dd94ecee3ec2c0cfc8a7ed409b98c.tar.gz"],
)

load("@io_tweag_rules_nixpkgs//nixpkgs:repositories.bzl", "rules_nixpkgs_dependencies")
rules_nixpkgs_dependencies()

load("@io_tweag_rules_nixpkgs//nixpkgs:nixpkgs.bzl", "nixpkgs_git_repository")
nixpkgs_git_repository(
    name = "nixpkgs",
    revision = "22.11",
    sha256 = "ddc3428d9e1a381b7476750ac4dbea7a42885cbbe6e1af44b21d6447c9609a6f",
)

load("@io_tweag_rules_nixpkgs//nixpkgs:nixpkgs.bzl", "nixpkgs_java_configure")

nixpkgs_java_configure(
    attribute_path = "jdk17.home",
    repository = "@nixpkgs",
    toolchain = True,
    toolchain_name = "nixpkgs_java",
    toolchain_version = "17",
)

http_archive(
    name = "rules_python",
    sha256 = "36362b4d54fcb17342f9071e4c38d63ce83e2e57d7d5599ebdde4670b9760664",
    strip_prefix = "rules_python-0.18.0",
    url = "https://github.com/bazelbuild/rules_python/releases/download/0.18.0/rules_python-0.18.0.tar.gz",
)

load("@rules_python//python:repositories.bzl", "py_repositories", "python_register_toolchains")

py_repositories()

python_register_toolchains(
    name = "python3_11",
    python_version = "3.11",
)

load("@python3_11//:defs.bzl", "interpreter")

load("@rules_python//python:pip.bzl", "pip_parse")

pip_parse(
    name = "pip",
    python_interpreter_target = interpreter,
    requirements_lock = "//:requirements_lock.txt",
)

load("@pip//:requirements.bzl", "install_deps")

install_deps()

http_archive(
    name = "remote_java_tools_darwin",
    sha256 = "aed319892b638efabd08405b8f835770e13e2465d20459876c5f457f2b6426f3",
    urls = [
            "https://mirror.bazel.build/bazel_java_tools/releases/java/v11.12/java_tools_darwin-v11.12.zip",
            "https://github.com/bazelbuild/java_tools/releases/download/java_v11.12/java_tools_darwin-v11.12.zip",
    ],
)

http_archive(
    name = "rules_java",
    urls = ["https://github.com/bazelbuild/rules_java/releases/download/5.4.1/rules_java-5.4.1.tar.gz"],
    sha256 = "a1f82b730b9c6395d3653032bd7e3a660f9d5ddb1099f427c1e1fe768f92e396",
)
load("@rules_java//java:repositories.bzl", "rules_java_dependencies", "rules_java_toolchains")
rules_java_dependencies()
rules_java_toolchains()

http_archive(
    name = "aspect_rules_ts",
    sha256 = "db77d904284d21121ae63dbaaadfd8c75ff6d21ad229f92038b415c1ad5019cc",
    strip_prefix = "rules_ts-1.3.0",
    url = "https://github.com/aspect-build/rules_ts/archive/refs/tags/v1.3.0.tar.gz",
)

load("@aspect_rules_ts//ts:repositories.bzl", LATEST_TS_VERSION="LATEST_VERSION", "rules_ts_dependencies")

rules_ts_dependencies(
    ts_version = LATEST_TS_VERSION,
)

load("@rules_nodejs//nodejs:repositories.bzl", "DEFAULT_NODE_VERSION", "nodejs_register_toolchains")

nodejs_register_toolchains(
    name = "node",
    node_version = DEFAULT_NODE_VERSION,
)

load("@aspect_rules_js//npm:npm_import.bzl", "npm_translate_lock")

npm_translate_lock(
    name = "npm",
    pnpm_lock = "//:pnpm-lock.yaml",
)

load("@npm//:repositories.bzl", "npm_repositories")

npm_repositories()

http_archive(
    name = "aspect_rules_esbuild",
    sha256 = "f9b5bf16251e3e4e127337ef968e6a398c9a4f353f1730e6c7ff6c9a8981e858",
    strip_prefix = "rules_esbuild-0.13.4",
    url = "https://github.com/aspect-build/rules_esbuild/archive/refs/tags/v0.13.4.tar.gz",
)

load("@aspect_rules_esbuild//esbuild:dependencies.bzl", "rules_esbuild_dependencies")

rules_esbuild_dependencies()

load("@aspect_rules_esbuild//esbuild:repositories.bzl", LATEST_ESBUILD_VERSION="LATEST_VERSION", "esbuild_register_toolchains")

esbuild_register_toolchains(
    name = "esbuild",
    esbuild_version = LATEST_ESBUILD_VERSION,
)

http_archive(
    name = "aspect_rules_jest",
    sha256 = "fa103b278137738ef08fd23d3c8c9157897a7159af2aa22714bc71680da58583",
    strip_prefix = "rules_jest-0.16.1",
    url = "https://github.com/aspect-build/rules_jest/archive/refs/tags/v0.16.1.tar.gz",
)

load("@aspect_rules_jest//jest:dependencies.bzl", "rules_jest_dependencies")

rules_jest_dependencies()

load("@aspect_rules_jest//jest:repositories.bzl", "jest_repositories")

jest_repositories(name = "jest")

load("@jest//:npm_repositories.bzl", jest_npm_repositories = "npm_repositories")

jest_npm_repositories()

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

RULES_KOTLIN_VERSION = "v1.7.1"

load("@rules_jvm_external//:defs.bzl", "maven_install")

http_archive(
    name = "io_bazel_rules_kotlin",
    sha256 = "fd92a98bd8a8f0e1cdcb490b93f5acef1f1727ed992571232d33de42395ca9b3",
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

setup_j2cl_workspace()

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

http_archive(
    name = "com_google_geometry_s2",
    sha256 = "61f159f82e91003199a8e2414b6715d9c63e1b621bd90d5e26e3546370db4bb6",
    strip_prefix = "s2-geometry-library-java-cd30c406ea3d0c7fb76e11b13c3ecdaa7066d968",
    urls = ["https://github.com/aschleck/s2-geometry-library-java/archive/cd30c406ea3d0c7fb76e11b13c3ecdaa7066d968.zip"],
)

http_archive(
    name = "rules_pkg",
    sha256 = "451e08a4d78988c06fa3f9306ec813b836b1d076d0f055595444ba4ff22b867f",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_pkg/releases/download/0.7.1/rules_pkg-0.7.1.tar.gz",
        "https://github.com/bazelbuild/rules_pkg/releases/download/0.7.1/rules_pkg-0.7.1.tar.gz",
    ],
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

load("@io_bazel_rules_docker//python3:image.bzl", _py3_image_repos = "repositories")

_py3_image_repos()

load("@io_bazel_rules_docker//container:pull.bzl", "container_pull")

container_pull(
    name = "container_java_17",
    digest = "sha256:e05f955883625cc717c7251037db590f08e6e4a322e73db60ef1492a9b7ce33e",
    registry = "gcr.io",
    repository = "distroless/java17",
    tag = "latest",
)
