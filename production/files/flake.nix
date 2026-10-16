{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }: {
    nixosConfigurations.violet = nixpkgs.lib.nixosSystem {
      modules = [ ./configuration.nix ];
    };
  };
}
