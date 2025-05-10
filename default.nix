{ pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/b3582c75c7f21ce0b429898980eddbbf05c68e55.tar.gz") { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    bazel-watcher
    bazelisk
    buildifier
    gdal
    google-cloud-sdk
    imagemagick
    jdk21_headless
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
