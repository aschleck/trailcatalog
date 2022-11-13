from pulumi import Output, ResourceOptions
from pulumi_gcp import artifactregistry, compute, projects, secretmanager, serviceaccount

network = compute.Network("default")

external_traffic = compute.Firewall(
    "external-traffic",
    network=network.name,
    source_ranges=["0.0.0.0/0"],
    allows=[
        compute.FirewallAllowArgs(
            protocol="tcp",
            ports=["22"]
        ),
        compute.FirewallAllowArgs(
            protocol="tcp",
            ports=["80", "443"]
        ),
    ],
)

internal_traffic = compute.Firewall(
    "internal-traffic",
    network=network.name,
    source_ranges=["10.128.0.0/9"],
    allows=[
        compute.FirewallAllowArgs(
            protocol="icmp",
        ),
        compute.FirewallAllowArgs(
            protocol="tcp",
            ports=["5432"]
        ),
    ],
)

iap_ssh_traffic = compute.Firewall(
    "iap-ssh-traffic",
    network=network.name,
    source_ranges=["35.235.240.0/20"],
    allows=[
        compute.FirewallAllowArgs(
            protocol="tcp",
            ports=["22"]
        ),
    ],
)

db_authorization = secretmanager.Secret(
    "db-authorization",
    secret_id="db-authorization",
    replication=secretmanager.SecretReplicationArgs(automatic=True),
)

import_cache_disk = compute.Disk(
    "import-cache",
    size=100,
    type="pd-standard",
    zone="us-west1-a",
)

pink = compute.Instance(
    "pink",
    name="pink",
    machine_type="e2-medium",
    zone="us-west1-a",
    boot_disk=compute.InstanceBootDiskArgs(
        initialize_params=compute.InstanceBootDiskInitializeParamsArgs(
            # No idea what happened to this
            # image="debian-cloud/debian-11",
            size=150,
        ),
    ),
    network_interfaces=[compute.InstanceNetworkInterfaceArgs(
        network=network.id,
        # An empty access config means an ephemeral IP
        access_configs=[compute.InstanceNetworkInterfaceAccessConfigArgs()],
    )],
    opts=ResourceOptions(ignore_changes=["metadata"]),
)

importer_account = serviceaccount.Account(
    "importer",
    account_id="importer",
)

projects.IAMBinding(
    "importer-basic-editor",
    project="trailcatalog",
    role="roles/editor",
    members=[importer_account.email.apply(lambda name: f"serviceAccount:{name}")],
)

# Not strictly needed, but we can hopefully scope the one above down at some point.
projects.IAMBinding(
    "importer-secrets-access",
    project="trailcatalog",
    role="roles/secretmanager.secretAccessor",
    members=[importer_account.email.apply(lambda name: f"serviceAccount:{name}")],
)

for preemptible in (True, False):
    provisioning_model = "SPOT" if preemptible else "STANDARD"
    name = f"importer-{provisioning_model.lower()}"
    compute.InstanceTemplate(
        name,
        name=name,
        machine_type="n2-highmem-2",
        opts=ResourceOptions(delete_before_replace=True),
        disks=[
            compute.InstanceTemplateDiskArgs(
                boot=True,
                disk_size_gb=10,
                disk_type="pd-balanced",
                source_image="projects/cos-cloud/global/images/cos-stable-101-17162-40-13",
            ),
            compute.InstanceTemplateDiskArgs(
                auto_delete=False,
                device_name="import-cache",
                source=import_cache_disk.name,
            ),
            compute.InstanceTemplateDiskArgs(
                device_name="local-ssd-0",
                disk_size_gb=375,
                disk_type="local-ssd",
                interface="NVME",
                type="SCRATCH",
            ),
            compute.InstanceTemplateDiskArgs(
                device_name="local-ssd-1",
                disk_size_gb=375,
                disk_type="local-ssd",
                interface="NVME",
                type="SCRATCH",
            ),
        ],
        metadata={
            "google-logging-enabled": "true",
            "user-data": Output.all(
                db_auth=db_authorization.secret_id,
                pink_ip=pink.network_interfaces[0].network_ip,
            ).apply(lambda args: f"""\
    #cloud-config

    bootcmd:
    - mkdir -p /mnt/disks/import_cache
    - mount -t ext4 /dev/disk/by-id/google-import-cache-part1 /mnt/disks/import_cache
    - chmod a+rwx /mnt/disks/import_cache
    - mdadm --create /dev/md0 --level=0 --raid-devices=2 /dev/nvme0n1 /dev/nvme0n2
    - mkfs.ext4 -F /dev/md0
    - mkdir -p /mnt/disks/scratch
    - mount -t ext4 -o discard,defaults,nobarrier /dev/md0 /mnt/disks/scratch
    - chmod a+rwx /mnt/disks/scratch

    write_files:
    - path: /var/lib/cloud/launcher.sh
      permissions: 0755
      owner: root
      content: |
        #!/bin/sh
        set -euxo pipefail

        /usr/bin/docker-credential-gcr configure-docker --registries=us-west1-docker.pkg.dev
        /usr/bin/docker \\
            run \\
            --name=aria2c \\
            --rm \\
            --mount type=bind,source=/mnt/disks/scratch,target=/tmp \\
            us-west1-docker.pkg.dev/trailcatalog/containers/aria2c:latest \\
            --dir /tmp \\
            --max-upload-limit=1K \\
            --seed-ratio=0.001 \\
            --seed-time=0 \\
            https://ftpmirror.your.org/pub/openstreetmap/pbf/planet-latest.osm.pbf.torrent

        mv /mnt/disks/scratch/planet-2*.osm.pbf /mnt/disks/scratch/planet-latest.osm.pbf

        auth_token="$(toolbox gcloud secrets versions access latest --secret {args['db_auth']} --quiet | tail -n 1)"
        echo "Got auth token: ${{auth_token}}"

        mkdir /mnt/disks/scratch/dems

        /usr/bin/docker-credential-gcr configure-docker --registries=us-west1-docker.pkg.dev
        /usr/bin/docker \\
            run \\
            --name=importer \\
            --rm \\
            --env DATABASE_URL="postgresql://{args['pink_ip']}/trailcatalog" \\
            --env DATABASE_USERNAME_PASSWORD="${{auth_token}}" \\
            --env JAVA_TOOL_OPTIONS="-Xms8g -Xmx11g -Xss1g -XX:MaxMetaspaceSize=1g" \\
            --mount type=bind,source=/mnt/disks/import_cache,target=/import_cache \\
            --mount type=bind,source=/mnt/disks/scratch,target=/tmp \\
            us-west1-docker.pkg.dev/trailcatalog/containers/importer:latest \\
            --block_size 4194304 \\
            --buffer_size 500000000 \\
            --elevation_profile /import_cache/elevation_profile.pb \\
            --heap_dump_threshold 3048000000 \\
            --pbf_path /tmp \\
            --source planet

        rm -rf /mnt/disks/scratch/dems

    - path: /var/lib/cloud/reaper.sh
      permissions: 0755
      owner: root
      content: |
        #!/bin/sh
        sleep 60s
        while ps ax | grep --quiet '[l]auncher.sh'; do sleep 10; done
        sleep 30s
        export NAME=$(curl -X GET http://metadata.google.internal/computeMetadata/v1/instance/name -H 'Metadata-Flavor: Google')
        export ZONE=$(curl -X GET http://metadata.google.internal/computeMetadata/v1/instance/zone -H 'Metadata-Flavor: Google')
        toolbox gcloud --quiet compute instances delete $NAME --zone=$ZONE
    - path: /etc/systemd/system/reaper.service
      permissions: 0644
      owner: root
      content: |
        [Unit]
        Description=Start the reaper

        [Service]
        ExecStart=/var/lib/cloud/reaper.sh
    - path: /etc/systemd/system/importer.service
      permissions: 0644
      owner: root
      content: |
        [Unit]
        Description=Start the docker container
        Wants=gcr-online.target
        After=gcr-online.target

        [Service]
        Environment="HOME=/home/trailcatalog"
        ExecStart=/var/lib/cloud/launcher.sh
        ExecStop=/usr/bin/docker stop importer
        ExecStopPost=/usr/bin/docker rm importer

    runcmd:
    - systemctl daemon-reload
    - systemctl start importer.service
    - systemctl start reaper.service
    """),
        },
        network_interfaces=[
            compute.InstanceTemplateNetworkInterfaceArgs(
                network=network.name,
                access_configs=[
                    compute.InstanceNetworkInterfaceAccessConfigArgs(network_tier="STANDARD"),
                ],
            ),
        ],
        scheduling=compute.InstanceTemplateSchedulingArgs(
            automatic_restart=False,
            instance_termination_action="DELETE" if preemptible else None,
            on_host_maintenance="TERMINATE",
            preemptible=preemptible,
            provisioning_model=provisioning_model,
        ),
        service_account=compute.InstanceTemplateServiceAccountArgs(
            email=importer_account.email,
            scopes=[
                "https://www.googleapis.com/auth/cloud-platform",
                "https://www.googleapis.com/auth/compute",
                "https://www.googleapis.com/auth/devstorage.read_only",
                "https://www.googleapis.com/auth/logging.write",
                "https://www.googleapis.com/auth/monitoring.write",
                "https://www.googleapis.com/auth/service.management.readonly",
                "https://www.googleapis.com/auth/servicecontrol",
                "https://www.googleapis.com/auth/trace.append",
            ],
        ),
    )

registry = artifactregistry.Repository(
        "containers",
        repository_id="containers",
        format="DOCKER",
        location="us-west1",
)

