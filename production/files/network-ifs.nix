{
  networking = {
    defaultGateway = { address = "<redacted>"; interface = "eth0"; };
    defaultGateway6 = { address = "<redacted>"; interface = "eth0"; };
    hostName = "violet";
    interfaces."eth0".ipv4.addresses = [ { address = "<redacted>"; prefixLength = 26; } ];
    interfaces."eth0".ipv6.addresses = [ { address = "<redacted>"; prefixLength = 64; } ];
    nameservers = [ "8.8.8.8" "8.8.4.4" ];
    useDHCP = false;

    firewall = {
      enable = true;
      allowedTCPPorts = [ 80 443 ];
      allowedUDPPorts = [ 41641 ];
      checkReversePath = "loose"; # To make Nix shut up about Tailscale's possible functionality

      interfaces."tailscale0".allowedTCPPorts = [ 22 5005 5432 ];
    };
  };
};
