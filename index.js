// index.js (require 버전, Windows에 안전)
const http = require('http');

const server = http.createServer((req, res) => {
  res.end('🎉 Hello from baggam.dev + Render!');
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});