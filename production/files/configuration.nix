{ config, pkgs, ... }:

{
  imports = [
    ./hardware-configuration.nix
    ./network-ifs.nix
  ];

  boot.initrd.services.swraid.mdadmConf = "ARRAY /dev/md0 metadata=1.2 name=pink:root0 UUID=92dd7dc4:a9fd64b0:96fedf9b:ca8548cf";
  boot.loader.systemd-boot.enable = false;
  boot.loader.grub = {
    enable = true;
    efiSupport = false;
    devices = [ "/dev/sda" "/dev/sdb" ];
  };

  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 80 443 ];
    allowedUDPPorts = [ 41641 ];
    checkReversePath = "loose"; # To make Nix shut up about Tailscale's possible functionality

    interfaces."tailscale0".allowedTCPPorts = [ 22 5432 ];
  };

  networking.hostName = "pink";
  security.sudo.wheelNeedsPassword = false;
  time.timeZone = "America/Los_Angeles";

  environment.systemPackages = with pkgs; [
    google-cloud-sdk
    iotop
    tmux
    vim
    wget
  ];

  security.acme = {
    acceptTerms = true;
    defaults.email = "trailcatalog@exclusivelyducks.com";
  };

  services.nginx = {
    enable = true;
    virtualHosts."trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;

      locations."/" = {
        proxyPass = "http://127.0.0.1:7080";
      };

      locations."/api/" = {
        proxyPass = "http://127.0.0.1:7070";
      };

      locations."/static/" = {
        proxyPass = "http://127.0.0.1:7060";
      };
    };

    virtualHosts."s2.trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;

      locations."/" = {
        proxyPass = "http://127.0.0.1:7061";
      };
    };

    virtualHosts."www.trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;
      globalRedirect = "trailcatalog.org";
    };
  };

  services.openssh = {
    enable = true;
    openFirewall = false;
    permitRootLogin = "prohibit-password";
  };

  services.postgresql = {
    enable = true;
    enableTCPIP = true;
    package = pkgs.postgresql_15;
    settings.effective_cache_size = "32GB";
    settings.shared_buffers = "16GB";

    authentication = pkgs.lib.mkForce ''
      # Generated file; do not edit!
      local all all peer
      host all all 127.0.0.1/32 scram-sha-256
      host trailcatalog trailcatalog 100.64.0.0/10 scram-sha-256
    '';
  };

  services.tailscale = {
    enable = true;
  };

  virtualisation.podman = {
    enable = true;
  };

  users.users.root.initialHashedPassword = "";
  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCwzMFKZ9sfhdugqr9XPshli+ciALSv9HWoMP7dY3d3bbDBXT5cKEMrTNq9maSrlU/uE6QDLHrNtMKDqADJs7wqcG3lDr2gAKRJZmvjlq2KqIcU0eNQR0TebeRDSlTuZWmhI+k1YNd0qn6t4vbj7ELdGhcwheqrMMtbI9A49sJdLWZaRMUSrts37UWQo0wvlitkUWEMXrh6Cy2L3YZetUG7fArsq1esdxHU8iF/yRAIz8XR4FP+1oiLahDxGhPP40gkw0XFh4kSNMcrMZ+bnK9WZg9CeNZYJZ3qC6uftkDgRo0cYo+ATnvK9LT7v7lt6xyFEuU8kn0EcVBpK+Wdoxad april@coolidge"
  ];

  users.users.april = {
    initialHashedPassword = "";
    isNormalUser = true;
    extraGroups = [ "wheel" ];

    openssh.authorizedKeys.keys = [
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCwzMFKZ9sfhdugqr9XPshli+ciALSv9HWoMP7dY3d3bbDBXT5cKEMrTNq9maSrlU/uE6QDLHrNtMKDqADJs7wqcG3lDr2gAKRJZmvjlq2KqIcU0eNQR0TebeRDSlTuZWmhI+k1YNd0qn6t4vbj7ELdGhcwheqrMMtbI9A49sJdLWZaRMUSrts37UWQo0wvlitkUWEMXrh6Cy2L3YZetUG7fArsq1esdxHU8iF/yRAIz8XR4FP+1oiLahDxGhPP40gkw0XFh4kSNMcrMZ+bnK9WZg9CeNZYJZ3qC6uftkDgRo0cYo+ATnvK9LT7v7lt6xyFEuU8kn0EcVBpK+Wdoxad april@coolidge"
    ];
  };

  systemd.services."tc-frontend" = {
    wantedBy = [ "multi-user.target" ];

    path = [
      pkgs.bash
      pkgs.google-cloud-sdk
      pkgs.podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/frontend.sh";
      Restart = "on-failure";
      User = "april";
    };
  };

  systemd.services."tc-import" = {
    startAt = "Mon,Thu *-*-* 02:00:00";

    path = [
      pkgs.bash
      pkgs.google-cloud-sdk
      pkgs.podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/import.sh";
      Type = "oneshot";
      User = "april";
    };
  };

  system.stateVersion = "22.11";
}
