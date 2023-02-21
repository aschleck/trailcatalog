{
  networking.useDHCP = false;
  networking.interfaces."enp9s0".ipv4.addresses = [
    {
      address = "<redacted>";
    }
  ];
  networking.interfaces."enp9s0".ipv6.addresses = [
    {
      address = "<redacted>";
    }
  ];
  networking.defaultGateway = "<redacted>";
  networking.defaultGateway6 = { address = "fe80::1"; interface = "enp9s0"; };
  networking.nameservers = [ "8.8.4.4" "8.8.8.8" ];
}
