load("@rules_distroless//distroless:defs.bzl", "cacerts", "group", "home", "java_keystore", "passwd")
load("@rules_oci//oci:defs.bzl", "oci_image")

package(default_visibility = ["//visibility:public"])

JAVA_HOME = "/usr/lib/jvm/java-21-openjdk-amd64"

# Debian puts java on PATH with update-alternatives in a postinst, so we name the JDK directly.
JAVA_ENV = {
    "JAVA_HOME": JAVA_HOME,
    "PATH": JAVA_HOME + "/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
}

cacerts(
    name = "cacerts",
    package = "@debian_testing//ca-certificates/amd64:data",
)

# cacerts only exposes its tar, and java_keystore needs the PEM bundle inside it.
genrule(
    name = "ca_bundle",
    srcs = [":cacerts"],
    outs = ["ca-certificates.crt"],
    cmd = "tar -xzOf $< ./etc/ssl/certs/ca-certificates.crt > $@",
)

# Debian builds this keystore in ca-certificates-java's postinst, which rules_distroless never runs.
java_keystore(
    name = "java_keystore",
    certificates = [":ca_bundle"],
)

home(
    name = "home",
    dirs = [
        {
            "home": "/root",
            "uid": 0,
            "gid": 0,
        },
        {
            "home": "/home/app",
            "uid": 1000,
            "gid": 1000,
        },
    ],
)

passwd(
    name = "passwd",
    entries = [
        {
            "uid": 0,
            "gid": 0,
            "home": "/root",
            "shell": "/bin/bash",
            "username": "root",
        },
        {
            "uid": 1000,
            "gid": 1000,
            "home": "/home/app",
            "shell": "/bin/bash",
            "username": "app",
        },
    ],
)

group(
    name = "group",
    entries = [
        {
            "name": "root",
            "gid": 0,
        },
        {
            "name": "app",
            "gid": 1000,
        },
    ],
)

oci_image(
    name = "base",
    architecture = "amd64",
    os = "linux",
    tars = [
        ":cacerts",
        ":group",
        ":home",
        ":passwd",
        "@debian_testing//base-files/amd64",
        "@debian_testing//netbase/amd64",
        "@debian_testing//tzdata/amd64",
    ],
)

oci_image(
    name = "nodejs",
    base = ":base",
    tars = [
        "@debian_testing//bash/amd64",
        # js_binary launchers start with /usr/bin/env
        "@debian_testing//coreutils/amd64",
    ],
)

oci_image(
    name = "java",
    base = ":base",
    env = JAVA_ENV,
    tars = [":java_tars"],
)

oci_image(
    name = "java_nodejs",
    base = ":nodejs",
    env = JAVA_ENV,
    tars = [":java_tars"],
)

filegroup(
    name = "java_tars",
    srcs = [
        ":java_keystore",
        "@debian_testing//openjdk-21-jre-headless/amd64",
    ],
)
