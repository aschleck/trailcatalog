{ pkgs ? import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/6afe187897bef7933475e6af374c893f4c84a293.tar.gz") { } }:

let
  reshape = pkgs.reshape.overrideAttrs (old: rec {
    src = pkgs.fetchFromGitHub {
      owner = "aschleck";
      repo = "reshape";
      rev = "9bc5629d21fe72fe620d9e8561d9d6db37c0b8ee";
      hash = "sha256-FvCgtv3DJVkTMoSZ8a1pWVRlekPIaXB1wfAqS/Ws6z0=";
    };
    cargoDeps = pkgs.rustPlatform.fetchCargoVendor {
      inherit src;
      hash = "sha256-yIiNk1bc0VpUBTQXuhv3Dye4CsI20qUr31Z2r14Qi2o=";
    };
  });
in
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
    nodePackages.npm
    nodePackages.pnpm
    nodejs-slim_20
    podman
    reshape
  ];

  shellHook = ''
    alias bazel=bazelisk
    alias vim=nvim
  '';
}
