require('dotenv').config();

// server.js (después de require('dotenv').config();
console.log('MONGODB_URI:', process.env.MONGODB_URI);
console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('PORT:', process.env.PORT);
const dns = require('dns');

dns.lookup('oh-shard-00-00.6861s.mongodb.net', (err, address, family) => {
  if (err) {
    console.error("Error resolviendo el hostname MongoDB Atlas:", err);
  } else {
    console.log('Dirección IP Resuelta para oh-shard-00-00.6861s.mongodb.net:', address);
  }
});


const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();
const path = require('path');

// Middleware de registro de solicitudes entrantes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.use(cors({
  origin: ['https://www.sistemasoh.cl', 'https://sistemasoh.cl'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Manejar solicitudes OPTIONS para todas las rutas
app.options('*', cors());

app.use(express.json());

// Conexión a la base de datos
mongoose.connect(process.env.MONGODB_URI, {
  ssl: true,
  sslValidate: true,
  // Otros parámetros si es necesario
}) 
  .then(() => console.log("Conectado a MongoDB Atlas"))
  .catch(err => {
    console.log("Error conectando a MongoDB Atlas", err);
    // Salir del proceso si la conexión falla
    process.exit(1);
  })


const clienteRoutes = require('./routes/clienteRoutes');
const facturaRoutes = require('./routes/facturaRoutes');
const abonoRoutes = require('./routes/abonoRoutes');  // abono facturas
const usuarioRoutes = require('./routes/usuarioRoutes');
const honorarioRoutes = require('./routes/honorarioRoutes');
const abonoHonorarioRoutes = require('./routes/abonoHonorarioRoutes'); // Nuevas rutas para honorarios


app.use('/api/clientes', clienteRoutes);
app.use('/api/facturas', facturaRoutes);
app.use('/api/abonos', abonoRoutes)
app.use("/api/usuarios", usuarioRoutes)
app.use('/api/honorarios', honorarioRoutes);
app.use('/api/abonosHonorarios', abonoHonorarioRoutes);


// Ruta de prueba para verificar la conexión
app.get('/api/test', (req, res) => {
  console.log('Ruta de prueba alcanzada');
  res.json({ message: 'Ruta de prueba exitosa' });
})

// Servir los archivos estáticos de la aplicación React
app.use(express.static(path.join(__dirname, 'frontend', 'build')));

// Cualquier ruta no reconocida servirá el index.html de React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  console.error(err.stack);
  res.status(500).json({ message: 'Error Interno del Servidor' });
 
});

// Passenger no necesita el puerto lo maneja por sí mismo
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Servidor corriendo en el puerto ${PORT}`);
// });

// Exportar la app para que Passenger la maneje
module.exports = app;