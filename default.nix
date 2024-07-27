{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    bazelisk
    buildifier
    gdal
    google-cloud-sdk
    imagemagick
    jdk22_headless
    neovim
    nginx
    nodePackages.pnpm
    nodejs-slim_20
    podman
  ];

  shellHook = ''
    alias bazel=bazelisk
    alias vim=nvim
  '';
}
