const net = require('net');

const host = 'oh-shard-00-00.6861s.mongodb.net';
const port = 27017;

const socket = new net.Socket();

socket.setTimeout(5000); // 5 segundos de timeout

socket.on('connect', () => {
  console.log(`Conexión exitosa a ${host}:${port}`);
  socket.destroy();
});

socket.on('timeout', () => {
  console.error(`Timeout conectando a ${host}:${port}`);
  socket.destroy();
});

socket.on('error', (err) => {
  console.error(`Error conectando a ${host}:${port}:`, err.message);
});

socket.connect(port, host);