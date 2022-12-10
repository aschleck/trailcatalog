# Additional commands to run on pink

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

