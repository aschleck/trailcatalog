{ config, lib, pkgs, ... }:

let
  # Every public request reaches us through Cloudflare.
  # https://www.cloudflare.com/ips/
  cloudflareIpv4 = [
    "173.245.48.0/20"
    "103.21.244.0/22"
    "103.22.200.0/22"
    "103.31.4.0/22"
    "141.101.64.0/18"
    "108.162.192.0/18"
    "190.93.240.0/20"
    "188.114.96.0/20"
    "197.234.240.0/22"
    "198.41.128.0/17"
    "162.158.0.0/15"
    "104.16.0.0/13"
    "104.24.0.0/14"
    "172.64.0.0/13"
    "131.0.72.0/22"
  ];
  cloudflareIpv6 = [
    "2400:cb00::/32"
    "2606:4700::/32"
    "2803:f800::/32"
    "2405:b500::/32"
    "2405:8100::/32"
    "2a06:98c0::/29"
    "2c0f:f248::/32"
  ];
in
{
  imports = [
    ./hardware-configuration.nix
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
      allowedUDPPorts = [ 41641 ];
      checkReversePath = "loose"; # To make Nix shut up about Tailscale's possible functionality

      # Only Cloudflare may reach nginx or else clients could skip it and spoof CF-Connecting-IP.
      extraCommands =
          lib.concatMapStrings (range: ''
            iptables -A nixos-fw -p tcp -s ${range} -m multiport --dports 80,443 -j nixos-fw-accept
          '') cloudflareIpv4
          + lib.concatMapStrings (range: ''
            ip6tables -A nixos-fw -p tcp -s ${range} -m multiport --dports 80,443 -j nixos-fw-accept
          '') cloudflareIpv6;

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

  # Without channels NIX_PATH points nix-shell at the flake's nixpkgs.
  nix.channel.enable = false;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

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

    # Cloudflare puts the client's address in CF-Connecting-IP. This is the only access log because
    # the frontends log at warn and the container nginxes don't log requests.
    commonHttpConfig = ''
      ${lib.concatMapStrings (range: "set_real_ip_from ${range};\n")
          (cloudflareIpv4 ++ cloudflareIpv6)}
      real_ip_header CF-Connecting-IP;

      # The journal timestamps each line so we leave out $time_local.
      log_format journal '$remote_addr $host "$request" $status $body_bytes_sent $request_time '
          '"$http_referer" "$http_user_agent" $request_id';
      access_log syslog:server=unix:/dev/log,nohostname journal;
    '';

    virtualHosts."trailcatalog.org" = {
      enableACME = true;
      forceSSL = true;

      locations."/" = {
        extraConfig = ''
          proxy_http_version 2;
          proxy_set_header X-Request-Id $request_id;
        '';
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
        # Keep in sync with java/lat/trails/frontend/server.ts#BODY_LIMIT_BYTES
        extraConfig = ''
          client_max_body_size 64m;
          proxy_set_header X-Request-Id $request_id;
        '';
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

      locations."/" = {
        extraConfig = ''
          add_header 'Vary' 'Origin' always;
          valid_referers server_names
              henrythasler.static.observableusercontent.com
              mango.exclusivelyducks.com
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
          # nginx doesn't inherit add_header from parent blocks so we duplicate
          add_header 'Access-Control-Allow-Origin' $http_origin always;
          add_header 'Cache-Control' 'public, max-age=31536000, immutable';
          add_header 'Vary' 'Origin' always;
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
      ExecStop = "${pkgs.podman}/bin/podman stop --ignore --time 10 trails-lat-frontend";
      Restart = "always";
    };
  };

  systemd.services."trailcatalog-frontend" = {
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
      ExecStop = "${pkgs.podman}/bin/podman stop --ignore --time 10 trailcatalog-frontend";
      Restart = "always";
    };
  };

  systemd.services."trailcatalog-import" = {
    enable = true;
    after = [ "podman.service" ];
    startAt = "*-*-* 02:00:00";
    restartIfChanged = false;

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

  systemd.services."trails-lat-conditions" = {
    enable = true;
    after = [ "podman.service" ];
    # Hourly because AirNow updates its contours hourly.
    startAt = "*-*-* *:15:00";
    restartIfChanged = false;

    path = with pkgs; [
      bash
      crun
      google-cloud-sdk
      jq
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/conditions.sh";
      Type = "oneshot";
    };
  };

  systemd.services."trails-lat-aviation-vectors" = {
    enable = true;
    after = [ "podman.service" ];
    # Weekly because airspace and airports change on the 28 day AIRAC cycle, and openAIP's daily
    # exports mostly repeat themselves.
    startAt = "Sun *-*-* 04:45:00";
    restartIfChanged = false;

    path = with pkgs; [
      bash
      crun
      google-cloud-sdk
      jq
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/aviation_vectors.sh";
      Type = "oneshot";
    };
  };

  systemd.services."trails-lat-time-zones" = {
    enable = true;
    after = [ "podman.service" ];
    startAt = "Sun *-*-* 05:15:00";
    restartIfChanged = false;

    path = with pkgs; [
      bash
      crun
      google-cloud-sdk
      jq
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/time_zones.sh";
      Type = "oneshot";
    };
  };

  systemd.services."trails-lat-faa-charts" = {
    enable = true;
    # The FAA posts each 56 day cycle about three weeks early, and faa_charts.py skips cycles it
    # already tiled.
    startAt = "daily";
    restartIfChanged = false;

    path = with pkgs; [
      pmtiles
      (python3.withPackages (ps: with ps; [ gdal numpy pillow ]))
    ];

    # faa_charts.py runs a worker on every core, so it waits for the frontend.
    serviceConfig = {
      CPUSchedulingPolicy = "idle";
      ExecStart = "/home/april/faa_charts.py";
      IOSchedulingClass = "idle";
      Nice = 19;
      Type = "oneshot";
    };
  };

  systemd.services."trails-lat-snodas" = {
    enable = true;
    after = [ "podman.service" ];
    # NSIDC posts each day at 13:00 UTC, or 14:00 while the US is on standard time, and once in 16
    # months at 21:00. snodas.sh skips until the day is posted.
    startAt = "hourly";
    restartIfChanged = false;

    path = with pkgs; [
      bash
      coreutils
      crun
      curl
      google-cloud-sdk
      pmtiles
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/snodas.sh";
      Type = "oneshot";
    };
  };

  systemd.services."trails-lat-ecmwf" = {
    enable = true;
    after = [ "podman.service" ];
    # ECMWF finishes publishing each 6 hourly run at an uneven time, and ecmwf.sh skips runs it
    # already tiled.
    startAt = "hourly";
    restartIfChanged = false;

    path = with pkgs; [
      bash
      coreutils
      crun
      google-cloud-sdk
      pmtiles
      podman
    ];

    serviceConfig = {
      ExecStart = "/home/april/ecmwf.sh";
      Type = "oneshot";
    };
  };

  systemd.services."trailcatalog-pmtiles" = {
    enable = true;
    after = [ "podman.service" ];
    requires = [ "podman.service" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      ExecStart = "${pkgs.pmtiles}/bin/pmtiles serve --port 9999 /home/april/tiles";
      Restart = "always";
    };
  };

  system.autoUpgrade = {
    enable = true;
    flake = "/etc/nixos#violet";
    upgrade = false;
  };

  # Nix removed --update-input and --recreate-lock-file, so the upgrade can't update the lock
  # itself.
  # https://nix.dev/manual/nix/latest/release-notes/rl-2.19
  systemd.services.nixos-upgrade.preStart =
    "${config.nix.package}/bin/nix flake update --flake /etc/nixos";

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
