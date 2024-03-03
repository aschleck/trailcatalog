load("@rules_nixpkgs_core//:nixpkgs.bzl", "nixpkgs_git_repository")
load("@rules_nixpkgs_java//:java.bzl", "nixpkgs_java_configure")

def _nixpkgs_repositories():
    nixpkgs_git_repository(
        name = "nixpkgs",
        revision = "22.11",
        sha256 = "ddc3428d9e1a381b7476750ac4dbea7a42885cbbe6e1af44b21d6447c9609a6f",
    )

    nixpkgs_java_configure(
        attribute_path = "jdk17.home",
        repository = "@nixpkgs",
        toolchain = True,
        toolchain_name = "nixpkgs_java",
        toolchain_version = "17",
        register = False,
    )

def _non_module_deps_impl(ctx):
    _nixpkgs_repositories()

non_module_deps = module_extension(
    implementation = _non_module_deps_impl,
)
