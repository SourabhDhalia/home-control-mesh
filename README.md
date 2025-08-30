# Home Control Mesh — RPC over MQTT on Ubuntu

Turn a boring weekend into a fun game: your **TV, phones, and laptops** take commands and **reply** with results in milliseconds — **without** closed vendor SDKs.

- **Backbone:** Eclipse **Mosquitto** broker on Ubuntu  
- **Pattern:** **RPC over MQTT** — requests include correlation IDs and reply topics; devices respond with status/data  
- **Adapters (no vendor APIs):** ADB / HDMI-CEC / IR / USB/BLE-HID / SSH / Wake-on-LAN / Shortcuts/Tasker  
- **Security:** Per-device users, UFW, **Tailscale** (recommended) or TLS on 8883  
- **Use cases:** Launch TV apps, switch inputs, wake laptops, start builds, fetch logs, restart services, health checks

> Example host used below: `192.168.29.201` (Ubuntu server). Replace with yours.

---

## Why this works (even without brand SDKs)

We speak the “universal languages” devices already understand:

- **ADB** (Android/Android TV): launch apps, send key events, query state  
- **HDMI-CEC**: power / input / transport over the HDMI cable  
- **IR blaster**: scripted remote for legacy gear  
- **USB/BLE-HID**: emulate keyboard/remote  
- **SSH / PowerShell**: run commands on PCs, collect logs  
- **Wake-on-LAN**: wake machines from sleep/off  
- **Shortcuts/Tasker**: trigger permitted flows on mobile

All glued together by an MQTT **request/response** layer with **correlation IDs** and **reply topics**.

---

## Architecture

```
[Phone / Web UI / Script]
        |
   (HTTP POST / CLI)
        v
[HTTP → MQTT Bridge] ---- publish ----> [Mosquitto Broker (Ubuntu)]
        ^                                       |
        |                                   subscribe
   JSON response <---- device reply ---- [Agents: tv / pc / nas / phone]
```

**Topics**
- Requests:  `home/<room>/<device>/rpc/req`  
- Responses: `home/<room>/<device>/rpc/resp/<corr>` (or a shared `reply_to`)  
- Heartbeat: `home/<room>/<device>/hb` (retained)  
- Presence/LWT: `home/<room>/<device>/status` → `online|offline` (retained)

---

## Quick Start (Ubuntu)

### 1) Install Mosquitto (broker) + clients
```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
```

### 2) Secure the broker (auth + UFW)
```bash
# create MQTT user
sudo mosquitto_passwd -c /etc/mosquitto/passwd homeuser

# minimal config (listener 1883 + auth)
sudo tee /etc/mosquitto/conf.d/10-local.conf >/dev/null <<'CONF'
listener 1883 0.0.0.0
allow_anonymous false
password_file /etc/mosquitto/passwd
persistence true
persistence_location /var/lib/mosquitto/
CONF

# firewall: OpenSSH always; prefer private overlay (Tailscale) or your LAN only
sudo ufw allow OpenSSH
sudo ufw allow from 100.0.0.0/8 to any port 1883 proto tcp   # allow only Tailscale peers
# OR (LAN-only example) sudo ufw allow from 192.168.0.0/16 to any port 1883 proto tcp
sudo ufw enable
sudo systemctl restart mosquitto
```

### 3) (Recommended) Private overlay with Tailscale
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Use your Tailscale IP (100.x.y.z) in clients. Avoid exposing 1883 to the public Internet.
```

### 4) Sanity check (pub/sub)
```bash
# subscriber (terminal A)
mosquitto_sub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD' -t 'home/#' -v

# publisher (terminal B)
mosquitto_pub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD'   -t 'home/livingroom/androidtv/rpc/req'   -m '{"cmd":"ping","corr":"demo-1","reply_to":"home/resp/demo-1"}'
```

---

## Agents & Bridge (reference implementations)

Create the files below on the appropriate machines. They implement the **RPC** flow and send **heartbeats** + **presence**.

### A) PC Agent (Linux/macOS) — Python (paho-mqtt)

**Capabilities**
- `wol` — send Wake-on-LAN to a MAC  
- `run` — run a shell command and return stdout  
- `ping` — simple health test

**Install deps**
```bash
sudo apt install -y python3 python3-pip etherwake
pip3 install paho-mqtt
```

**Run**
```bash
BROKER=127.0.0.1 MQTT_USER=homeuser MQTT_PASS=YOUR_PASSWORD ROOM=office DEVICE_ID=deskpc python3 agents/pc_agent.py
```

### B) TV Agent (Android TV) — Node.js + ADB

**Capabilities**
- `launch_app` — start an Android TV app by package  
- `key` — send a key event (e.g., `KEYCODE_HOME`)  
- `power` — toggle power key  
- `ping` — respond with pong

**Install deps**
```bash
sudo apt install -y adb nodejs npm
npm init -y
npm install mqtt
```

**Run**
```bash
BROKER=127.0.0.1 MQTT_USER=homeuser MQTT_PASS=YOUR_PASSWORD ROOM=livingroom DEVICE=androidtv TV_IP=192.168.29.120 node agents/tv_agent.js
```

### C) HTTP → MQTT Bridge — Node.js

Expose a simple HTTP endpoint so phones/web UIs can call **one URL** and get a **JSON reply** when the device responds.

**Install deps**
```bash
npm install mqtt uuid
```

**Run**
```bash
BROKER=127.0.0.1 MQTT_USER=homeuser MQTT_PASS=YOUR_PASSWORD HTTP_PORT=8080 node bridge/http_bridge.js
```

---

## Try it (end-to-end)

Subscribe to all responses:
```bash
mosquitto_sub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD' -t 'home/resp/#' -v
```

TV: launch YouTube
```bash
mosquitto_pub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD'   -t 'home/livingroom/androidtv/rpc/req'   -m '{"cmd":"launch_app","args":{"app":"com.google.android.youtube.tv"},"corr":"tv-1","reply_to":"home/resp/tv-1"}'
```

PC: start a build
```bash
mosquitto_pub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD'   -t 'home/office/deskpc/rpc/req'   -m '{"cmd":"run","args":{"sh":"cd ~/proj && make -j4"},"corr":"pc-42","reply_to":"home/resp/pc-42"}'
```

PC: wake another machine
```bash
mosquitto_pub -h 127.0.0.1 -u homeuser -P 'YOUR_PASSWORD'   -t 'home/office/deskpc/rpc/req'   -m '{"cmd":"wol","args":{"mac":"a1:b2:c3:d4:e5:f6"},"corr":"wol-1","reply_to":"home/resp/wol-1"}'
```

---

## Security checklist (do these)

- Disable anonymous access; use **strong per-device passwords**  
- Prefer **Tailscale** (private overlay) or **TLS on 8883** if exposing publicly  
- Lock ports with **UFW**; never expose 1883 to the open Internet  
- Use **Last-Will** + heartbeats for presence  
- Add **timeouts**, **retries**, and **idempotent** commands  
- Rotate creds/keys regularly; keep ADB pairing keys safe

---

## Troubleshooting

- **No responses?** Verify `reply_to`, `corr`, and that agents subscribed to `rpc/req`.  
- **ADB flaky?** Use Ethernet if possible; ensure TV allows network debugging.  
- **CEC not working?** Enable CEC in TV settings and check your HDMI chain.  
- **WOL fails?** Enable WOL in BIOS/UEFI and confirm the MAC.  
- **TLS errors?** Ensure `cafile/certfile/keyfile` paths and domain match.  
- **Mosquitto won’t start?** `journalctl -u mosquitto -e` for logs.

---

## Repo layout (suggested)

```
home-control-mesh/
├─ README.md
├─ agents/
│  ├─ pc_agent.py
│  └─ tv_agent.js
└─ bridge/
   └─ http_bridge.js
```

Add `conf/` and `systemd/` if you want to keep broker configs and services versioned.

---

## License

MIT

---

### Credits

Built with a weekend-challenge mindset by turning **boring** into **fun** — and making the home the prize.
