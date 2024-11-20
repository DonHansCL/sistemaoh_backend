// routes/facturaRoutes.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const { register, login } = require('../controllers/authController');
const { verifyToken, checkRole } = require('../middleware/auth');
const Factura = require('../models/Factura');
const router = express.Router();
const Cliente = require('../models/Cliente'); // Asegúrate de importar el modelo de cliente
const Abono = require('../models/Abonos'); // Asegúrate de importar el modelo de abono
const mongoose = require('mongoose');

// Configuración de multer para manejar el archivo CSV
const upload = multer({ dest: 'uploads/' });

// Función para convertir fecha de DD-MM-YYYY a objeto Date
function convertirFecha(fechaString) {
  const regex = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/;
  const match = fechaString.match(regex);
  if (!match) return null;

  let [, parte1, parte2, parte3] = match;

  let dia, mes, año;

  if (fechaString.includes('-')) {
    dia = parseInt(parte1, 10);
    mes = parseInt(parte2, 10);
    año = parseInt(parte3, 10);
  } else {
    mes = parseInt(parte1, 10);
    dia = parseInt(parte2, 10);
    año = parseInt(parte3, 10);
  }

  if (año < 100) {
    año += 2000;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return null;
  }

  const fecha = new Date(año, mes - 1, dia);

  if (
    fecha.getFullYear() !== año ||
    fecha.getMonth() !== mes - 1 ||
    fecha.getDate() !== dia
  ) {
    return null;
  }

  return fecha;
}

// Definir la ruta para cargar el archivo CSV
router.post('/upload', upload.single('file'), verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const resultados = [];
    let fila = 1;

    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv({ separator: ';' }))
          .on('data', (data) => {
            resultados.push({
              fila,
              numero: data.numero ? data.numero.trim() : '',
              clienteRut: data.clienteRut ? data.clienteRut.trim() : '',
              fechaEmision: data.fechaEmision ? data.fechaEmision.trim() : '',
              fechaPago: data.fechaPago ? data.fechaPago.trim() : '',
              estado: data.estado ? data.estado.trim().toLowerCase() : '',
              monto: data.monto ? data.monto.trim() : '',
            });
            fila++;
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (error) => {
            reject(error);
          });
      });

      const errores = [];

      for (const item of resultados) {
        const { fila, numero, clienteRut, fechaEmision, fechaPago, estado, monto } = item;

        if (!numero || !clienteRut || !fechaEmision || !estado || !monto) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Faltan campos obligatorios.',
          });
          continue;
        }

        const fechaEmisionDate = convertirFecha(fechaEmision);
        if (!fechaEmisionDate) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Formato de fecha de emisión inválido.',
          });
          continue;
        }

        let fechaPagoDate = null;
        if (fechaPago) {
          fechaPagoDate = convertirFecha(fechaPago);
          if (!fechaPagoDate) {
            errores.push({
              fila,
              estado: 'Error',
              detalles: 'Formato de fecha de pago inválido.',
            });
            continue;
          }
        }

        if (!['pendiente', 'pagada', 'abonada'].includes(estado)) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: `Estado inválido: ${estado}.`,
          });
          continue;
        }

        const montoNumber = parseFloat(monto);
        if (isNaN(montoNumber) || montoNumber < 0) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: 'Monto inválido.',
          });
          continue;
        }

        const facturaExistente = await Factura.findOne({ numero }).session(session);
        if (facturaExistente) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: `Factura con número ${numero} ya existe.`,
          });
          continue;
        }

        const clienteExistente = await Cliente.findOne({ rut: clienteRut }).session(session);
        if (!clienteExistente) {
          errores.push({
            fila,
            estado: 'Error',
            detalles: `Cliente con RUT ${clienteRut} no encontrado.`,
          });
          continue;
        }
      }

      if (errores.length > 0) {
        await session.abortTransaction();
        session.endSession();

        fs.unlinkSync(req.file.path);

        return res.status(400).json({
          message: 'Error en la carga masiva.',
          errores,
        });
      }

      const facturasParaInsertar = resultados.map((item) => ({
        numero: item.numero,
        clienteRut: item.clienteRut,
        fechaEmision: convertirFecha(item.fechaEmision),
        fechaPago: item.fechaPago ? convertirFecha(item.fechaPago) : null,
        estado: item.estado,
        monto: parseFloat(item.monto),
      }));

      await Factura.insertMany(facturasParaInsertar, { session });

      await session.commitTransaction();
      session.endSession();

      fs.unlinkSync(req.file.path);

      res.status(200).json({ message: 'Carga completada exitosamente.' });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error('Error al procesar el archivo CSV:', error);
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al procesar el archivo CSV.' });
    }
  }
)





// Crear una nueva factura
router.post('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { numero, clienteRut, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    // Verificar si el cliente con el RUT dado existe
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    // Crear la factura usando el RUT del cliente
    const nuevaFactura = new Factura({
      numero,
      clienteRut, // Ahora guardamos el RUT
      fechaEmision,
      fechaPago,
      estado,
      monto,
    });

    await nuevaFactura.save();
    res.status(201).json(nuevaFactura);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// Obtener facturas por RUT de cliente
router.get('/rut/:rut', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  try {
    const { rut } = req.params;
    
    const facturas = await Factura.find({ clienteRut: rut });

    
    res.json(facturas);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Error al obtener facturas.', error: error.message });
  }
});




// Obtener una factura por su ID
router.get('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar factura por su _id (que es un ObjectId)
    const factura = await Factura.findById(id);

    if (!factura) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    // Buscar el cliente usando el RUT almacenado en la factura
    const cliente = await Cliente.findOne({ rut: factura.clienteRut });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Retornar la factura con el nombre del cliente
    res.json({
      ...factura.toObject(),
      clienteNombre: cliente.nombre,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});




// Obtener factura por facturaID
router.get('/:facturaId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const facturaId = req.params.facturaId;
  try {
      const factura = await Factura.findById(facturaId);
      if (!factura) {
        return res.status(404).json({ error: 'Factura no encontrada' });
      }
      // Buscar el cliente por RUT
      const cliente = await Cliente.findOne({ rut: factura.clienteRut });
      if (!cliente) {
          return res.status(404).json({ message: 'Cliente no encontrado' });
      }

      console.log("Factura encontrada:", factura);
      console.log("Cliente encontrado:", cliente); // Agrega esto para verificar si se obtiene el cliente
      
      res.json({
        factura,
        cliente: {
            nombre: cliente.nombre, // Solo envías el nombre y rut del cliente
            rut: cliente.rut
        }
    })

  } catch (error) {
      console.error('Error al obtener factura:', error.message);
      res.status(500).json({ error: 'Error interno del servidor' });
  }
})














// Obtener todas las facturas, con filtrado opcional por rango de fechas o por año/mes
router.get('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  try {
    const { startDate, endDate, year, month } = req.query;
    // console.log('startDate:', startDate, 'endDate:', endDate, "año", year, "mes", month)
    let query = {};

    // Si se envían startDate y endDate, se filtran las facturas por ese rango de fechas
    if (startDate && endDate) {
        const fechaInicio = new Date(startDate); // Asegúrate de que estas conversiones son correctas
        const fechaFin = new Date(endDate);
        if (isNaN(fechaInicio) || isNaN(fechaFin)) {
          return res.status(400).json({ error: 'Fechas no válidas' });
      }
      // Ajusta la comparación para el campo correcto
        query.fechaEmision = { $gte: fechaInicio, $lte: fechaFin };
    } 
    // Si se envían year y month, se filtran las facturas por ese año y mes
    else if (year && month) {
        const inicioMes = new Date(year, month - 1, 1); // Primer día del mes
        const finMes = new Date(year, month, 0); // Último día del mes
        query.fechaEmision = { $gte: inicioMes, $lte: finMes };
    }

    // Obtener las facturas filtradas
    const facturas = await Factura.find(query); // Utiliza el objeto query para filtrar

    // Para cada factura, buscar el cliente usando el RUT y agregar su nombre
    const facturasConCliente = await Promise.all(facturas.map(async (factura) => {
      const cliente = await Cliente.findOne({ rut: factura.clienteRut });
      return {
        ...factura.toObject(),
        clienteNombre: cliente ? cliente.nombre : 'Cliente no encontrado',
      };
    }));

    if (facturasConCliente.length === 0) {
      return res.json({ message: "No se encontraron facturas en el rango seleccionado." });
    }

    res.json(facturasConCliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})




// Actualizar una factura existente por ID
router.put('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;
  const { numero, clienteRut, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    // 1. Verificar si el cliente con el RUT dado existe
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    // 2. Obtener la factura actual
    const facturaActual = await Factura.findById(id);
    if (!facturaActual) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }


    // 3. Preparar los campos a actualizar
    const camposActualizacion = {
      numero,
      clienteRut,
      fechaEmision,
      fechaPago,
      estado,
      monto,
    };

     // 4. Convertir el 'id' a ObjectId para la agregación
     const facturaObjectId = new mongoose.Types.ObjectId(id);

    // 4. Calcular la suma de los abonos existentes para esta factura
    const sumAbonosResult = await Abono.aggregate([
      { $match: { factura_id: facturaObjectId } },
      { $group: { _id: null, total: { $sum: '$monto' } } },
    ]);

    const totalAbonado = sumAbonosResult[0]?.total || 0;

    console.log(`Suma de abonos para la factura ${id}: ${totalAbonado}`);

    // 5. Ajustar `total_abonado` y posiblemente `estado` basado en el nuevo estado
    if (estado === 'pagada') {
      // Si el estado se establece en 'pagada', setear `total_abonado` al monto total
      camposActualizacion.total_abonado = monto;
    } else if (estado === 'abonada') {
      // Si el estado se establece en 'abonada', ajustar `total_abonado` a la suma de abonos
      if (totalAbonado >= monto) {
        // Si la suma de abonos iguala o excede el monto, cambiar estado a 'pagada'
        camposActualizacion.estado = 'pagada';
        camposActualizacion.total_abonado = monto; // Evitar exceder el monto
      } else {
        camposActualizacion.total_abonado = totalAbonado;
      }
    } else if (estado === 'pendiente') {
      // Si el estado se establece en 'pendiente', mantener `total_abonado` como la suma de abonos
      camposActualizacion.total_abonado = totalAbonado;
    }

    // 6. Validar que `total_abonado` no exceda el `monto`
    if (camposActualizacion.total_abonado > monto) {
      return res.status(400).json({ error: 'El total abonado excede el monto de la factura.' });
    }

    // 7. Actualizar la factura en la base de datos
    const facturaActualizada = await Factura.findByIdAndUpdate(
      id,
      { $set: camposActualizacion },
      { new: true, runValidators: true }
    );

    if (!facturaActualizada) {
      return res.status(404).json({ error: 'Factura no encontrada después de la actualización.' });
    }

    res.json(facturaActualizada);
  } catch (error) {
    console.error('Error al actualizar la factura:', error);
    res.status(400).json({ error: error.message });
  }
})



// Actualizar una factura abonada existente por ID, cambio el estado a abonado y el monto_abonado
router.put('/abonar/:facturaId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { facturaId } = req.params;
  const { total_abonado, estado } = req.body;

  try {
    // Verificar si la factura existe
    const facturaExistente = await Factura.findById(facturaId);
    if (!facturaExistente) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    // Actualizar solo los campos total_abonado y estado
    facturaExistente.total_abonado = total_abonado;
    facturaExistente.estado = estado;

    // Guardar la factura actualizada
    const facturaActualizada = await facturaExistente.save();

    res.json(facturaActualizada);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})



// Eliminar una factura por su número
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    const factura = await Factura.findById(id);

    if (!factura) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    await factura.deleteOne();  // Esto activará el middleware 'pre-remove'
    
    res.json({ message: 'Factura y abonos eliminados exitosamente', factura });
  } catch (error) {
    console.error('Error al eliminar la factura:', error);
    res.status(400).json({ error: error.message });
  }
})

module.exports = router;
