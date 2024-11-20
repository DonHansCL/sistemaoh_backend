// models/Usuario.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Asegúrate de importar bcrypt aquí

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nombre: { type: String, required: true },
  role: {
    type: String,
    enum: ['ADMIN', 'FACTURACION', 'USER'],
    default: 'USER'
  },
   avatar: { type: String, default: 'hombre1.png' },
}, {
  timestamps: true,
  toJSON: { virtuals: true }, // Incluir virtuales en JSON
  toObject: { virtuals: true } // Incluir virtuales en objetos
});


// Definir un virtual para 'id' que mapea a '_id'
userSchema.virtual('id').get(function () {
  return this._id.toHexString();
})

// Definir un virtual para 'id' que mapea a '_id'
// userSchema.virtual('role').get(function () {
//   return this.role
// })


// Middleware para encriptar la contraseña antes de guardar
userSchema.pre('save', async function (next) {
  const user = this;

  // Solo encriptar si la contraseña ha sido modificada o es nueva
  if (!user.isModified('password')) return next();

  try {
    // Genera el hash de la contraseña
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
    next();
  } catch (error) {
    return next(error);
  }
});

// Método para comparar contraseñas
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};


// para encriptar si se actualiza la contraseña
userSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();

  // Solo encriptar si la contraseña ha sido modificada
  if (update.password) {
    try {
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(update.password, salt);
    } catch (error) {
      return next(error);
    }
  }
  next();
})


const Usuario = mongoose.model('Usuario', userSchema);
module.exports = Usuario;
