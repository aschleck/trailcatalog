{
  description = "trailcatalog development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };

        reshape = pkgs.reshape.overrideAttrs (old: rec {
          version = "0.11.2";
          src = pkgs.fetchFromGitHub {
            owner = "aschleck";
            repo = "reshape";
            rev = "d6f6a495d57e5b6597100619a9a1f3e1059eb5ab";
            hash = "sha256-1xL0bd2wqhvXo5Ta6EFDyQMkeWb5OKBzVAhHW0VZjEg=";
          };
          cargoDeps = pkgs.rustPlatform.fetchCargoVendor {
            inherit src;
            hash = "sha256-Y9uoza88Zj/8v3L/Onqzo5iy2EeAjeLoREJGwCnECRo=";
          };
          doCheck = with pkgs; lib.meta.availableOn stdenv.hostPlatform postgresqlTestHook;
        });
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bazel-watcher
            bazelisk
            buildifier
            gdal
            google-cloud-sdk
            imagemagick
            jdk21_headless
            jetbrains.idea
            neovim
            nginx
            nodejs-slim_24
            pnpm
            podman
            postgresql
            python3
            reshape
          ];

          shellHook = ''
            alias bazel=bazelisk
            alias vim=nvim
            export HISTFILESIZE=
            export HISTSIZE=
            export PS1="\[\033[1;32m\][tc:\w]\$\[\033[0m\] "
          '';
        };
      });
}
