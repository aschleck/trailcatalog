# Production configs for Trailcatalog

## Additional commands to run on pink after creation

```sh
sudo apt-get install -y cloud-init
sudo cloud-init init
sudo /root/initialize.sh  # why is this not run by cloud-init?

sudo tailscale up
sudo vim /etc/postgresql/15/main/postgresql.conf
# add
# listen_addresses = 'localhost,10.138.0.2,100.90.53.123'
sudo vim /etc/fstab
# add noatime to /dev/sda

sudo certbot --nginx

## Playbook

### Changing disk type

1. Take a snapshot of the target disk
1. Shutdown the instance
1. Detach the disk from its instance
1. Delete the disk
1. Create a new disk from the snapshot (you may have to wait a few minutes to use the same name)
1. Attach the disk to the instance
1. Start the instance
