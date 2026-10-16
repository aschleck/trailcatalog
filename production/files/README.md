# Files to push to the server

1. Download the frontend secrets key from GCP
1. Push the rest
1. `sudo nixos-generate-config`
1. `sudo nixos-rebuild switch --flake /etc/nixos#violet --option experimental-features "nix-command flakes"`
