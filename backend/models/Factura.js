const mongoose = require('mongoose');
const Abono = require('./Abonos');

const facturaSchema = new mongoose.Schema({
  numero: { type: String, required: true, unique: true },
  clienteRut: { type: String, required: true },
  fechaEmision: { type: Date, required: true },
  fechaPago: { type: Date },
  estado: { type: String, enum: ['pendiente', 'pagada', 'abonada'], default: 'pendiente' },
  total_abonado: { type: Number, default: 0, min: 0 }, // Para llevar el control del monto abonado
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
