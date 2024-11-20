// models/AbonoHonorario.js
const mongoose = require('mongoose');

const abonoHonorarioSchema = new mongoose.Schema({
    honorario_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Honorario',  // Referencia al modelo de Honorario
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

const AbonoHonorario = mongoose.model('AbonoHonorario', abonoHonorarioSchema);
module.exports = AbonoHonorario;