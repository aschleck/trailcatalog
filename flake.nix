{
  description = "trailcatalog development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

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
            neovim
            nginx
            nodejs-slim_22
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
