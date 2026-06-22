# mqtt-broker

Broker MQTT local (Aedes) usado como alternativa ao Mosquitto via Docker,
para desenvolvimento em máquinas sem Docker disponível. `start-all.sh`
usa este broker automaticamente quando `docker` não é encontrado no PATH.

## Rodar

```bash
npm install
npm start
```

Porta padrão: `1883` (configurável via `MQTT_PORT` no `.env`, veja `.env.example`).
