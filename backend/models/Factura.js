const mongoose = require('mongoose');
const Abono = require('./Abonos');

const facturaSchema = new mongoose.Schema({
  numero: { type: String, required: true, unique: true },
  clienteRut: { type: String, required: true, index: true }, // Índice agregado
  fechaEmision: { type: Date, required: true, index: true }, // Índice agregado
  fechaPago: { type: Date, index: true }, // Índice agregado
  estado: { type: String, enum: ['pendiente', 'pagada', 'abonada'], default: 'pendiente', index: true }, // Índice agregado
  total_abonado: { type: Number, default: 0, min: 0 },
  monto: { type: Number, required: true, min: 0 },
});



facturaSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  try {
    await Abono.deleteMany({ factura_id: this._id });
    next();
  } catch (error) {
    next(error);
  }
})

module.exports = mongoose.model('Factura', facturaSchema);
