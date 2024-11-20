// routes/usuarioRoutes.js
const express = require('express');
const Usuario = require('../models/User');
const router = express.Router();
const { register, login, registerUser } = require('../controllers/authController');
const { verifyToken, checkRole, authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcryptjs')



// Ruta para crear nuevos usuarios
router.post('/register', registerUser)

// Ruta para hacer login
router.post('/login', login)



// Obtener el usuario actual
router.get('/me', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        // Buscar el usuario en la base de datos usando el ID del token
        const usuario = await Usuario.findById(req.user.id);
        if (!usuario) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        // Crear objeto de usuario con los campos necesarios
        const user = {
            id: usuario.id, // virtual 'id' del modelo
            nombre: usuario.nombre,
            email: usuario.email,
            role: usuario.role, // Mapea 'rol' a 'role' para consistencia en el frontend
            avatar: usuario.avatar,
            // Añade otros campos si es necesario
        };

        res.json(user); // Devuelve la información del usuario con 'id'
    } catch (error) {
        console.error('Error en la ruta /me:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
})



// Crear un usuario
router.post('/', async (req, res) => {
    const { nombre, email, role, password } = req.body; // Cambiado 'contraseña' a 'password' y agregado 'role'
    const nuevoUsuario = new Usuario({ nombre, email, role, password }); // Incluido 'role'

    try {
        await nuevoUsuario.save();
        res.status(201).json(nuevoUsuario);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
})




// Obtener todos los usuarios
router.get('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
        const usuarios = await Usuario.find();
        res.json(usuarios);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Obtener un usuario por ID
router.get('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(usuario);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})


// Actualizar un usuario
router.put('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { nombre, email, role, password, avatar } = req.body; // Agregado 'role'
    try {
        const updateData = { nombre, email, role, avatar }; // Incluido 'role'
        if (password) updateData.password = password;

        const usuario = await Usuario.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(usuario);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
})

// Eliminar un usuario
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    try {
        const usuario = await Usuario.findByIdAndDelete(req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ message: 'Usuario eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});





module.exports = router;
