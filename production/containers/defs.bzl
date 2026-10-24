load("@aspect_rules_js//js:defs.bzl", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

def frontend_image(name, nginx_conf, pkg, repository, runner):
    """Packages nginx, the Node frontend, and the API server jar that serve.sh runs together."""
    pkg_tar(
        name = name + "_app",
        files = {
            nginx_conf: "app/nginx.conf",
            "serve.sh": "app/serve.sh",
        },
        modes = {
            "app/serve.sh": "0755",
        },
    )

    js_image_layer(
        name = name + "_runner",
        binary = runner,
        platform = "//build_defs:linux_amd64",
        root = "/app",
    )

    oci_image(
        name = name,
        base = "//build_defs/distroless:java_nodejs",
        cmd = ["/app/serve.sh"],
        env = {
            "RUNNER": "/app/" + runner.removeprefix("//").replace(":", "/"),
        },
        tars = [
            ":" + name + "_app",
            ":" + name + "_runner",
            "@debian_testing//nginx/amd64",
            pkg,
            # after nginx because nginx-common ships this directory as root's
            ":nginx_state",
        ],
        user = "app",
    )

    oci_load(
        name = name + "_load",
        image = ":" + name,
        repo_tags = ["localhost/" + name + ":latest"],
    )

    oci_push(
        name = name + "_push",
        image = ":" + name,
        remote_tags = ["latest"],
        repository = "us-west1-docker.pkg.dev/trailcatalog/containers/" + repository,
    )
