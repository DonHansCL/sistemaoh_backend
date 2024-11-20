// models/Abono.js
const mongoose = require('mongoose');

const abonoSchema = new mongoose.Schema({
    factura_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Factura',  // Referencia al modelo de Factura
        required: true 
    },
    
    monto: { 
        type: Number, 
        required: true, 
        min: [0, 'El monto debe ser mayor que 0']  // Validación para que no haya abonos negativos
    },
    fecha: { 
        type: Date, 
        default: Date.now  // Fecha actual por defecto
    },
    comentario: { 
        type: String, 
        trim: true  // Elimina espacios en blanco al inicio y al final
    }
});

const Abono = mongoose.model('Abono', abonoSchema);
module.exports = Abono;
