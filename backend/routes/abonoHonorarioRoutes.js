// routes/abonoHonorarioRoutes.js
const express = require('express');
const AbonoHonorario = require('../models/AbonoHonorario');
const Honorario = require('../models/Honorario');
const { verifyToken, checkRole } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// Crear un nuevo abono para un honorario
router.post('/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { honorarioId } = req.params;
    const { monto, fecha, comentario } = req.body;

    if (!mongoose.isValidObjectId(honorarioId)) {
        return res.status(400).json({ message: 'ID de honorario no válido' });
    }

    try {
        // Buscar el honorario por ID
        const honorario = await Honorario.findById(honorarioId);
        if (!honorario) {
            return res.status(404).json({ message: 'Honorario no encontrado' });
        }


         // Verificar si el honorario ya está pagado
         if (honorario.estado === 'pagada') {
            return res.status(400).json({ message: 'No se pueden realizar abonos a un honorario ya pagado.' });
        }

        // Calcular el nuevo total_abonado
        const nuevoTotalAbonado = honorario.total_abonado + monto;

        // Validar que no exceda el monto total
        if (nuevoTotalAbonado > honorario.monto) {
            return res.status(400).json({ message: 'El abono excede el monto total del honorario.' });
        }


        // Crear nuevo abono
        const nuevoAbono = new AbonoHonorario({
            honorario_id: new mongoose.Types.ObjectId(honorarioId),
            monto: monto,
            fecha: fecha || Date.now(),
            comentario: comentario
        });

        await nuevoAbono.save();

        // Actualizar el total abonado del honorario
        honorario.total_abonado = nuevoTotalAbonado;

        // Verificar si el total abonado alcanza o supera el monto total del honorario
        if (honorario.total_abonado === honorario.monto) {           
            honorario.estado = 'pagada';
        } else if (honorario.total_abonado > 0) {
            honorario.estado = 'abonada';
        }

        await honorario.save();

        res.status(201).json(nuevoAbono);
    } catch (error) {
        console.error('Error al crear el abono de honorario:', error);
        res.status(500).json({ message: 'Error al crear el abono de honorario' });
    }
});

// Obtener todos los abonos para un honorario
router.get('/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { honorarioId } = req.params;

    if (!mongoose.isValidObjectId(honorarioId)) {
        return res.status(400).json({ message: 'ID de honorario no válido' });
    }

    try {
        const abonos = await AbonoHonorario.find({ honorario_id: honorarioId });

        // Retorna siempre un array, incluso si está vacío
        res.json(abonos);
    } catch (error) {
        console.error('Error al obtener abonos de honorario:', error);
        res.status(500).json({ message: 'Error al obtener abonos de honorario' });
    }
});

// Eliminar un abono de honorario
router.delete('/:abonoId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { abonoId } = req.params;

    if (!mongoose.isValidObjectId(abonoId)) {
        return res.status(400).json({ message: 'ID de abono no válido' });
    }

    try {
        const abonoEliminado = await AbonoHonorario.findByIdAndDelete(abonoId);
        if (!abonoEliminado) {
            return res.status(404).json({ message: 'Abono no encontrado' });
        }

        // Actualizar el total_abonado y estado del honorario asociado
        if (abonoEliminado.honorario_id) {
            const honorario = await Honorario.findById(abonoEliminado.honorario_id);
            if (honorario) {
                honorario.total_abonado -= abonoEliminado.monto;
                
                // Asegurar que el total_abonado no sea negativo
                if (honorario.total_abonado < 0) {
                    honorario.total_abonado = 0;
                }

                // Actualizar el estado basado en el nuevo total_abonado
                if (honorario.total_abonado === 0) {
                    honorario.estado = 'pendiente';
                } else if (honorario.total_abonado < honorario.monto) {
                    honorario.estado = 'abonada';
                } else if (honorario.total_abonado === honorario.monto) {
                    honorario.estado = 'pagada';
                }

                await honorario.save();
            }
        }
        
        res.status(200).json({ message: 'Abono de honorario eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar abono de honorario:', error);
        res.status(500).json({ message: 'Error al eliminar abono de honorario' });
    }
});

module.exports = router;