import aedes from 'aedes';
import net from 'node:net';

const broker = aedes();
const server = net.createServer(broker.handle);
const PORT = Number(process.env.MQTT_PORT) || 1883;

server.listen(PORT, () => {
  console.log(`[MQTT BROKER] Aedes broker listening on port ${PORT}`);
});

broker.on('client', (client) => {
  console.log(`[MQTT BROKER] client connected: ${client.id}`);
});

broker.on('clientDisconnect', (client) => {
  console.log(`[MQTT BROKER] client disconnected: ${client.id}`);
});

broker.on('publish', (packet, client) => {
  if (client) {
    console.log(`[MQTT BROKER] publish from ${client.id}: ${packet.topic}`);
  }
});

process.on('SIGINT', async () => {
  console.log('[MQTT BROKER] SIGINT received, shutting down');
  server.close(() => broker.close(() => process.exit(0)));
});
