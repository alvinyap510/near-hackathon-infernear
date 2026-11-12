# Deploying the relay

The relay runs as one Docker container behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). The server opens no inbound port: `cloudflared` connects out to Cloudflare, and the public hostname reaches the relay only through it. The dashboard is a static build hosted separately (for example on Vercel).

**Status: prepared, not yet run against a live server.**

## Relay

1. In Cloudflare Zero Trust, create a tunnel (Networks → Tunnels → cloudflared) and copy its token. Add a public hostname, for example `api.<your-domain>`, with service `http://relay:8787`.
2. On a server with Docker, clone this repository and create `.env` from `.env.example`, readable only by its owner (`chmod 600 .env`). The relay container receives this whole file, so keep deployment-only keys (`NEAR_DEPLOYER_PRIVATE_KEY`, `NEAR_RHEA_VAULT_PRIVATE_KEY`, `EVM_DEPLOYER_PRIVATE_KEY`) in a separate file that only the deploy scripts read. Set the relay and keeper sections, plus:
   - `RELAY_PUBLIC_URL=https://api.<your-domain>`
   - `RELAY_PORT=8787`
   - `RELAY_CLIENT_IP_HEADER=cf-connecting-ip`
   - `RELAY_WEB_ORIGIN=` the dashboard's origin
   - `CLOUDFLARE_TUNNEL_TOKEN=` the token from step 1
3. From the repository root:

   ```sh
   docker compose --env-file .env -f deploy/compose.yaml up -d --build
   ```

4. The relay waits 30 seconds before listening. Then `curl https://api.<your-domain>/v1/models` lists the TEE models.

Keep the relay without a published port. If it were reachable directly, a client could set `cf-connecting-ip` itself and choose its own rate-limit bucket.

## Dashboard

Import the repository into Vercel with root directory `web`; the Vite preset builds `dist`. Set every `VITE_*` variable listed in [web/README.md](../web/README.md) in the project settings, with `VITE_RELAY_URL=https://api.<your-domain>`.
