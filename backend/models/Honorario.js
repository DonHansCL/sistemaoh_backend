// models/Honorario.js
const mongoose = require('mongoose');
const Abono = require('./Abonos');

const honorarioSchema = new mongoose.Schema({
  clienteRut: { type: String, ref: 'Cliente', required: true },  
  fechaEmision: { type: Date, required: true },
  fechaPago: { type: Date },
  estado: { type: String, enum: ['pendiente', 'pagada', 'abonada'], default: 'pendiente' },
  total_abonado: { type: Number, default: 0, min: 0 },
  monto: { type: Number, required: true, min: 0 },
});

honorarioSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  try {
    await Abono.deleteMany({ honorario_id: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

honorarioSchema.index({ estado: 1, fechaPago: 1 })

module.exports = mongoose.model('Honorario', honorarioSchema);
