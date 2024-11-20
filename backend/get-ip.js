const https = require('https');

https.get('https://ifconfig.me', (resp) => {
  let data = '';

  resp.on('data', (chunk) => {
    data += chunk;
  });

  resp.on('end', () => {
    console.log("Server's Outgoing IP:", data.trim());
  });

}).on("error", (err) => {
  console.log("Error: " + err.message);
});