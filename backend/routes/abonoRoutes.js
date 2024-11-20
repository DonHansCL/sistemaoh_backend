const express = require('express');
const Abono = require('../models/Abonos');
const { verifyToken, checkRole } = require('../middleware/auth');
const Factura = require('../models/Factura');
const router = express.Router();
const mongoose = require('mongoose')
const Honorario = require('../models/Honorario');


router.post('/:facturaId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { facturaId } = req.params;
    const { monto, fecha, comentario } = req.body;

    if (!mongoose.isValidObjectId(facturaId)) {
        return res.status(400).json({ message: 'ID de factura no válido' });
    }

    try {
        // Buscar la factura por ID
        const factura = await Factura.findById(facturaId)
        if (!factura) {
            return res.status(404).json({message: "Factura no encontrada"});
        }

        // Verificar si la factura ya está pagada
        if (factura.estado === 'pagada') {
          return res.status(400).json({ message: 'No se pueden realizar abonos a una factura ya pagada.' });
      }

      // Calcular el nuevo total_abonado
      const nuevoTotalAbonado = factura.total_abonado + monto;

      // Validar que no exceda el monto total
      if (nuevoTotalAbonado > factura.monto) {
          return res.status(400).json({ message: 'El abono excede el monto total de la factura.' });
      }

        // crear nuevo abono
        const nuevoAbono = new Abono({
            factura_id: new mongoose.Types.ObjectId(facturaId),
            monto: monto,
            fecha: fecha || Date.now(),   // Usar la fecha proporcionada o la fecha actual si no se especifica
            comentario: comentario
        });

        await nuevoAbono.save();

        // actualizar el total abonado de la factura
        factura.total_abonado = nuevoTotalAbonado

         // verficar si el total abonado alcanza o supera el monto total de la factura
         if (factura.total_abonado === factura.monto ) {            
            factura.estado = 'pagada'
         } else if (factura.total_abonado > 0) {
            factura.estado = 'abonada'  // si hay unn abono parcial, pero no se ha pagado el total
         }

         await factura.save();

        res.status(201).json(nuevoAbono) 

    } catch (error) {
        console.error('Error al crear el abono:', error);
        res.status(500).json({ message: 'Error al crear el abono' });
    }
});




// Obtener todos los abonos para una factura
router.get('/:facturaId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const facturaId = req.params.facturaId;
    try {
        const abonos = await Abono.find({ factura_id: facturaId });
        
        if (!abonos || abonos.length === 0) {
            return res.status(200).json([]);  // Asegúrate de que la respuesta siempre sea un JSON válido
        }

        res.json(abonos);
    } catch (error) {
        console.error("Error del servidor:", error.message);
        res.status(500).json({ error: 'Error interno del servidor' });  // Siempre responde con JSON
    }
});



// Crear un nuevo abono para un honorario
router.post('/honorario/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { honorarioId } = req.params;
    const { monto, fecha, comentario } = req.body;
  
    if (!mongoose.isValidObjectId(honorarioId)) {
      return res.status(400).json({ message: 'ID de honorario no válido' });
    }
  
    try {
      const honorario = await Honorario.findById(honorarioId);
      if (!honorario) {
        return res.status(404).json({ message: 'Honorario no encontrado' });
      }
  
      const nuevoAbono = new Abono({
        honorario_id: new mongoose.Types.ObjectId(honorarioId),
        monto: monto,
        fecha: fecha || Date.now(),
        comentario: comentario,
      });
  
      await nuevoAbono.save();
  
      honorario.total_abonado += monto;
  
      if (honorario.total_abonado >= honorario.monto) {
        honorario.total_abonado = honorario.monto;
        honorario.estado = 'pagada';
      } else if (honorario.total_abonado > 0) {
        honorario.estado = 'abonada';
      }
  
      await honorario.save();
  
      res.status(201).json(nuevoAbono);
    } catch (error) {
      console.error('Error al crear el abono:', error);
      res.status(500).json({ message: 'Error al crear el abono' });
    }
  });
  
  // Obtener todos los abonos de un honorario
  router.get('/honorario/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { honorarioId } = req.params;
  
    if (!mongoose.isValidObjectId(honorarioId)) {
      return res.status(400).json({ message: 'ID de honorario no válido' });
    }
  
    try {
      const abonos = await Abono.find({ honorario_id: honorarioId });
      res.json(abonos);
    } catch (error) {
      console.error('Error al obtener abonos:', error);
      res.status(500).json({ message: 'Error al obtener abonos' });
    }
  });



// Ruta para eliminar un abono
router.delete('/:abonoId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
    const { abonoId } = req.params;

    if (!mongoose.isValidObjectId(abonoId)) {
        return res.status(400).json({ message: 'ID de abono no válido' });
    }

    try {
        const abonoEliminado = await Abono.findByIdAndDelete(abonoId);
        if (!abonoEliminado) {
            return res.status(404).json({ message: 'Abono no encontrado' });
        }

         // Actualizar el total_abonado de la factura asociada
          // Obtener la factura asociada
        const factura = await Factura.findById(abonoEliminado.factura_id);
        if (factura) {
              factura.total_abonado -= abonoEliminado.monto;
              
              // Asegurar que el total_abonado no sea negativo
              if (factura.total_abonado < 0) {
                  factura.total_abonado = 0;
              }

              // Actualizar el estado basado en el nuevo total_abonado
              if (factura.total_abonado === 0) {
                  factura.estado = 'pendiente';
              } else if (factura.total_abonado < factura.monto) {
                  factura.estado = 'abonada';
              } else if (factura.total_abonado === factura.monto) {
                  factura.estado = 'pagada';
              }

              await factura.save();
          }
      

      res.status(200).json({ message: 'Abono eliminado exitosamente' });
  } catch (error) {
      console.error('Error al eliminar el abono:', error);
      res.status(500).json({ message: 'Error al eliminar el abono' });
  }
})


module.exports = router;
