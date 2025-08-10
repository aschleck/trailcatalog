{ config, pkgs, ... }:

{
  imports = [
    ./hardware-configuration.nix
    ./network-ifs.nix
  ];

  security.sudo.wheelNeedsPassword = false;
  time.timeZone = "America/Los_Angeles";

  boot = {
    loader = {
      systemd-boot.enable = false;
      grub = {
        enable = true;
        efiSupport = false;
        devices = [ "/dev/nvme0n1" "/dev/nvme1n1" ];
      };
    };

    swraid.mdadmConf = ''
      ARRAY /dev/md0 metadata=1.2 name=violet:root0 UUID=9fcf23a1:493bce57:0bce267b:711180c7
      MAILADDR trailcatalog@exclusivelyducks.com
    '';
  };

  networking = {
    defaultGateway = { address = "135.181.164.65"; interface = "eth0"; };
    defaultGateway6 = { address = "fe80::1"; interface = "eth0"; };
    hostName = "violet";
    interfaces."eth0".ipv4.addresses = [ { address = "135.181.164.107"; prefixLength = 26; } ];
    interfaces."eth0".ipv6.addresses = [ { address = "2a01:4f9:3a:1bd1::1"; prefixLength = 64; } ];
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

  environment.systemPackages = with pkgs; [
    google-cloud-sdk
    iotop
    tmux
    vim
    wget
  ];

  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 7d";
  };

  security.acme = {
    acceptTerms = true;
    defaults.email = "trailcatalog@exclusivelyducks.com";
  };

  services.nginx = {
    enable = true;
    recommendedProxySettings = true;

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

    virtualHosts."trails.lat" = {
      enableACME = true;
      forceSSL = true;

      locations."/" = {
        proxyPass = "http://127.0.0.1:7059";
      };
    };

    virtualHosts."s2.trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;

      locations."/" = {
        proxyPass = "http://127.0.0.1:7061";
      };
    };

    virtualHosts."tiles.trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;

      locations."~ \\.pmtiles$" = {
        return = "403";
      };

      locations."/" = {
        root = "/mnt/horse/tiles";

        extraConfig = ''
          add_header 'Vary' 'Origin' always;
          valid_referers server_names
              henrythasler.static.observableusercontent.com
              mango.exclusivelyducks.com
              protomaps.github.io
              s2.trailcatalog.org
              stevage.github.io
              trailcatalog.org
              trails.lat
              ~^\d+\.\d+\.\d+\.\d+(:\d+)?/
              ~^[a-z]+:(\d+)?/;

          if ($invalid_referer) {
            return 403;
          }

          add_header 'Access-Control-Allow-Origin' $http_origin always;
          try_files $uri @pmtiles;

          if ($request_method = 'OPTIONS') {
            # nginx doesn't inherit add_header from parent blocks so we duplicate
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Access-Control-Allow-Headers' $http_access_control_allow_headers always;
            add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
            add_header 'Access-Control-Allow-Origin' $http_origin always;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            add_header 'Content-Length' 0;
            add_header 'Vary' 'Origin' always;
            return 204;
          }
        '';
      };

      locations."@pmtiles" = {
        proxyPass = "http://127.0.0.1:9999";

        extraConfig = ''
          proxy_hide_header 'Access-Control-Allow-Origin';
          add_header 'Access-Control-Allow-Origin' $http_origin always;
        '';
      };
    };

    virtualHosts."www.trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;
      globalRedirect = "trailcatalog.org";
    };

    virtualHosts."www.trails.lat" = {
      enableACME = true;
      forceSSL = true;
      globalRedirect = "trails.lat";
    };
  };

  services.openssh = {
    enable = true;
    openFirewall = false;
    settings.PermitRootLogin = "prohibit-password";
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
      host trails_lat trails_lat 100.64.0.0/10 scram-sha-256
    '';
  };

  services.tailscale = {
    enable = true;
  };

  systemd.services."trails-lat-frontend" = {
    enable = true;
    after = [ "podman.service" ];
    requires = [ "podman.service" ];
    wantedBy = [ "multi-user.target" ];

    path = with pkgs; [
      bash
      crun
      google-cloud-sdk
      jq
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/trails_lat_frontend.sh";
      Restart = "always";
    };
  };

  systemd.services."tc-frontend" = {
    enable = true;
    after = [ "podman.service" ];
    requires = [ "podman.service" ];
    wantedBy = [ "multi-user.target" ];

    path = [
      pkgs.bash
      pkgs.crun
      pkgs.google-cloud-sdk
      pkgs.podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/trailcatalog_frontend.sh";
      Restart = "always";
    };
  };

  systemd.services."tc-import" = {
    enable = true;
    after = [ "podman.service" ];
    requires = [ "podman.service" ];
    startAt = "Mon,Thu *-*-* 02:00:00";

    path = with pkgs; [
      bash
      crun
      google-cloud-sdk
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/import.sh";
      Type = "oneshot";
    };
  };

  systemd.services."tc-pmtiles" = {
    enable = true;
    after = [ "podman.service" ];
    requires = [ "podman.service" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      ExecStart = "/home/april/tiles/pmtiles serve --port 9999 /home/april/tiles";
      Restart = "always";
    };
  };

  system.autoUpgrade = {
    channel = "https://nixos.org/channels/nixos-unstable";
    enable = true;
  };

  virtualisation.podman = {
    enable = true;
  };

  users = {
    users = {
      april = {
        initialHashedPassword = "";
        isNormalUser = true;
        extraGroups = [ "wheel" ];

        openssh.authorizedKeys.keys = [
          "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGOeC2iDtGyF6NFICisMDE/3suW7Q+biy6HOtKYhUbt3"
          "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCwzMFKZ9sfhdugqr9XPshli+ciALSv9HWoMP7dY3d3bbDBXT5cKEMrTNq9maSrlU/uE6QDLHrNtMKDqADJs7wqcG3lDr2gAKRJZmvjlq2KqIcU0eNQR0TebeRDSlTuZWmhI+k1YNd0qn6t4vbj7ELdGhcwheqrMMtbI9A49sJdLWZaRMUSrts37UWQo0wvlitkUWEMXrh6Cy2L3YZetUG7fArsq1esdxHU8iF/yRAIz8XR4FP+1oiLahDxGhPP40gkw0XFh4kSNMcrMZ+bnK9WZg9CeNZYJZ3qC6uftkDgRo0cYo+ATnvK9LT7v7lt6xyFEuU8kn0EcVBpK+Wdoxad april@coolidge"
        ];
      };

      root = {
        initialHashedPassword = "";
        openssh.authorizedKeys.keys = [
          "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCwzMFKZ9sfhdugqr9XPshli+ciALSv9HWoMP7dY3d3bbDBXT5cKEMrTNq9maSrlU/uE6QDLHrNtMKDqADJs7wqcG3lDr2gAKRJZmvjlq2KqIcU0eNQR0TebeRDSlTuZWmhI+k1YNd0qn6t4vbj7ELdGhcwheqrMMtbI9A49sJdLWZaRMUSrts37UWQo0wvlitkUWEMXrh6Cy2L3YZetUG7fArsq1esdxHU8iF/yRAIz8XR4FP+1oiLahDxGhPP40gkw0XFh4kSNMcrMZ+bnK9WZg9CeNZYJZ3qC6uftkDgRo0cYo+ATnvK9LT7v7lt6xyFEuU8kn0EcVBpK+Wdoxad april@coolidge"
        ];
      };
    };
  };

  system.stateVersion = "25.05"; # Did you read the comment?
}
