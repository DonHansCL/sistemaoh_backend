// models/Cliente.js
const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    rut: { type: String, required: true, unique: true },
    direccion: { type: String, required: true },
    email: { type: String, required: true },
    saldoPendiente: { type: Number, default: 0 }
});

const Cliente = mongoose.model('Cliente', clienteSchema);
module.exports = Cliente;
