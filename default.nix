{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    bazelisk
    gdal
    google-cloud-sdk
    imagemagick
    jdk19_headless
    nginx
    nodePackages.pnpm
    nodejs-slim_20
    podman
  ];

  shellHook = ''
    alias bazel=bazelisk
  '';
}
