// routes/honorarioRoutes.js
const express = require('express');
const { verifyToken, checkRole } = require('../middleware/auth');
const Honorario = require('../models/Honorario');
const Cliente = require('../models/Cliente');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const AbonoHonorario = require('../models/AbonoHonorario');
const mongoose = require('mongoose');
const upload = multer({ dest: 'uploads/' });

// Función para convertir fecha de DD-MM-YYYY a objeto Date
function convertirFecha(fechaString) {
  const partes = fechaString.split('-');
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1; // Months are zero-based
  const anio = parseInt(partes[2], 10);
  return new Date(anio, mes, dia);
}

function esFechaValida(fechaString) {
  const regexFecha = /^\d{2}-\d{2}-\d{4}$/;
  if (!regexFecha.test(fechaString)) {
    return false;
  }

  const partes = fechaString.split('-');
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const anio = parseInt(partes[2], 10);

  const fecha = new Date(anio, mes - 1, dia);
  return (
    fecha.getFullYear() === anio &&
    fecha.getMonth() === mes - 1 &&
    fecha.getDate() === dia
  );
}


// Crear un nuevo honorario
router.post('/', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { clienteRut, descripcion, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    const nuevoHonorario = new Honorario({
      clienteRut: clienteExistente.rut, // Asignar rut directamente
      descripcion,
      fechaEmision,
      fechaPago,
      estado,
      monto,
    });

    await nuevoHonorario.save();
    
    res.status(201).json(nuevoHonorario);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});



// Similarmente, crear rutas para los resúmenes de honorarios
router.get('/resumen-honorarios', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // **Honorarios Pagados Este Mes**
    const honorariosPagadasMes = await Honorario.countDocuments({
      estado: 'pagada',
      fechaPago: { $gte: startOfMonth, $lte: endOfMonth }
    });

    // **Honorarios Pendientes**
    const honorariosPendientes = await Honorario.countDocuments({
      estado: { $in: ['pendiente', 'abonada'] }
    });

    // **Honorarios Totales**
    const honorariosTotales = await Honorario.countDocuments({});

    // **Total Honorado**
    const totalHonoradosResult = await Honorario.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: "$monto" }
        }
      }
    ]);
    const totalHonorados = totalHonoradosResult.length > 0 ? totalHonoradosResult[0].total : 0;

    // **Total Abonos Honorarios**
    const totalAbonosHonorariosResult = await AbonoHonorario.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: "$monto" }
        }
      }
    ]);
    const totalAbonosHonorarios = totalAbonosHonorariosResult.length > 0 ? totalAbonosHonorariosResult[0].total : 0;

    // **Total Adeudado Honorarios**
    const totalAdeudadoHonorariosResult = await Honorario.aggregate([
      {
        $match: {
          estado: { $in: ['pendiente', 'abonada'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$monto" }
        }
      }
    ]);
    const totalAdeudadoHonorarios = totalAdeudadoHonorariosResult.length > 0 ? totalAdeudadoHonorariosResult[0].total : 0;

     // **Resumen por Cliente**
     const resumenHonorariosClientes = await Honorario.aggregate([
       {
        $group: {
          _id: "$clienteRut",
          // Para honorarios 'pendiente' o 'abonada', sumamos (monto - total_abonado)
          saldoPendienteHonorarios: {
            $sum: {
              $cond: [
                { $in: ["$estado", ["pendiente", "abonada"]] },
                { $subtract: ["$monto", { $ifNull: ["$total_abonado", 0] }] },
                0
              ]
            }
          },
          // Para estado 'abonada', sumamos total_abonado
          abonosHonorarios: {
            $sum: {
              $cond: [
                { $eq: ["$estado", "abonada"] },
                { $ifNull: ["$total_abonado", 0] },
                0
              ]
            }
          },
          cantidadHonorariosPendientes: {
            $sum: {
              $cond: [
                { $in: ["$estado", ["pendiente", "abonada"]] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          clienteRut: "$_id",
          saldoPendienteHonorarios: 1,
          abonosHonorarios: 1,
          cantidadHonorariosPendientes: 1,
          _id: 0
        }
      }
    ]);

    const resumenHonorarios = {
      honorariosPagadasMes,
      honorariosPendientes,
      honorariosTotales,
      totalHonorados,
      totalAbonosHonorarios,
      totalAdeudadoHonorarios,
      clientes: resumenHonorariosClientes // Array de resúmenes por cliente
    };

    res.json(resumenHonorarios);
  } catch (error) {
    console.error('Error al obtener resumen de honorarios:', error);
    res.status(500).json({ error: 'Error al obtener resumen de honorarios.', detalles: error.message });
  }
});





// Carga masiva de honorarios desde CSV
router.post('/upload', upload.single('file'), verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const resultados = [];
  let fila = 1; // Contador de filas

  // Verificar si se ha subido un archivo
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ningún archivo.' });
  }

  const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Leer y procesar el CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv({ separator: ';' }))
          .on('data', (data) => {
            resultados.push({ ...data, fila: fila++ });           
          })
          .on('end', resolve)
          .on('error', reject);
      })
  
      const resultadosProcesamiento = [];

    // Validar todas las filas antes de insertar
      for (const item of resultados) {
        const filaActual = item.fila;
        const erroresFila = [];

        if (!item.clienteRut || item.clienteRut.trim() === '') {
          erroresFila.push('El campo "clienteRut" es obligatorio.');
        }
        if (!item.fechaEmision || item.fechaEmision.trim() === '') {
          erroresFila.push('El campo "fechaEmision" es obligatorio.');
        }
        if (!item.monto || item.monto.trim() === '') {
          erroresFila.push('El campo "monto" es obligatorio.');
        }

        // Validar estado si está presente
        if (item.estado && !['pendiente', 'pagada'].includes(item.estado.trim().toLowerCase())) {
          erroresFila.push('El campo "estado" debe ser "pendiente" o "pagada".');
        }

        // Si hay errores, registrar y continuar con la siguiente fila
      if (erroresFila.length > 0) {
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Error',
          detalles: erroresFila.join(' '),
        });
        continue;
      }

      // Validar formato de fechaEmision
      if (!esFechaValida(item.fechaEmision)) {
        erroresFila.push('El campo "fechaEmision" tiene un formato inválido.');
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Error',
          detalles: erroresFila.join(' '),
        });
        continue;
      }

      const fechaEmisionObj = convertirFecha(item.fechaEmision);

      // Validar y convertir fecha de pago si está presente
      let fechaPagoObj = null;
      if (item.fechaPago && item.fechaPago.trim() !== '') {
        if (!esFechaValida(item.fechaPago)) {
          resultadosProcesamiento.push({
            fila: filaActual,
            estado: 'Error',
            detalles: 'El campo "fechaPago" tiene un formato inválido.',
          });
          continue;
        }
        fechaPagoObj = convertirFecha(item.fechaPago);
      }

      // Validar que el monto sea un número válido
      if (isNaN(parseFloat(item.monto))) {
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Error',
          detalles: `El monto "${item.monto}" no es un número válido.`,
        });
        continue;
      } else {
        item.monto = parseFloat(item.monto);
      }


      // Determinar el valor de total_abonado basado en el estado
      let totalAbonado = 0;
        if (item.estado && item.estado.trim().toLowerCase() === 'pagada') {
          totalAbonado = item.monto;
        } else if (item.total_abonado && !isNaN(parseFloat(item.total_abonado))) {
          totalAbonado = parseFloat(item.total_abonado);
        } else {
          totalAbonado = 0;
        }

       // Verificar si el cliente existe
       const clienteExistente = await Cliente.findOne({ rut: item.clienteRut });
       if (!clienteExistente) {
         resultadosProcesamiento.push({
           fila: filaActual,
           estado: 'Error',
           detalles: `El cliente con RUT ${item.clienteRut} no existe.`,
         });
         continue;
       }

       // Verificar duplicados
      const honorarioExistente = await Honorario.findOne({
        clienteRut: item.clienteRut,
        fechaEmision: convertirFecha(item.fechaEmision),
        monto: parseFloat(item.monto),
      }).session(session);

      if (honorarioExistente) {
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Error',
          detalles: `Honorario a ${item.clienteRut}, ${item.fechaEmision} y ${item.monto} ya existe.`,
  });
        continue;
      }
       
       


      // Insertar todos los honorarios en la base de datos dentro de la transacción
      const nuevoHonorario = new Honorario ({
        clienteRut: item.clienteRut.trim(),
        fechaEmision: convertirFecha(item.fechaEmision),
        fechaPago: item.fechaPago,
        estado: item.estado ? item.estado.trim().toLowerCase() : 'pendiente',
        monto: parseFloat(item.monto),
        total_abonado: totalAbonado,
      })

      try {
        await nuevoHonorario.save({ session });
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Éxito',
          detalles: `Honorario creado exitosamente.`,
        });
      } catch (error) {
        resultadosProcesamiento.push({
          fila: filaActual,
          estado: 'Error',
          detalles: `Error al crear el Honorario: ${error.message}`,
        });
      }
    }

      // Commit de la transacción
      await session.commitTransaction();
      session.endSession();

      // Eliminar el archivo temporal
      fs.unlinkSync(req.file.path);

      // Enviar la respuesta con la confirmación de éxito
      res.status(200).json({ resultados: resultadosProcesamiento });
    } catch (error) {
      // Abort de la transacción en caso de error
      await session.abortTransaction();
      session.endSession();

      console.error('Error al procesar el archivo CSV:', error);
      // Eliminar el archivo temporal en caso de error
      fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al procesar el archivo CSV.' });
    }
  }
)

// Obtener honorarios por RUT de cliente
router.get('/rut/:rut', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  try {
    const { rut } = req.params;
    const cliente = await Cliente.findOne({ rut });

    if (!cliente) {
      return res.json([]);
    }

    // Buscar honorarios con clienteRut igual al RUT del cliente
    const honorarios = await Honorario.find({ clienteRut: cliente.rut });


    // Agregar el nombre del cliente manualmente
    const honorariosConCliente = honorarios.map(honorario => ({
      ...honorario.toObject(),
      clienteNombre: cliente.nombre,
    }));

    res.json(honorariosConCliente);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener honorarios.', error: error.message });
  }
})

// Obtener un honorario por su ID
router.get('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    const honorario = await Honorario.findById(id);

    if (!honorario) {
      return res.status(404).json({ message: 'Honorario no encontrado.' });
    }

    // Obtener detalles del cliente basado en clienteRut
    const cliente = await Cliente.findOne({ rut: honorario.clienteRut });
    if (!cliente) {
      return res.status(404).json({ message: 'Cliente asociado no encontrado.' });
    }

    // Retornar honorario con detalles del cliente
    res.json({
      ...honorario.toObject(),
      clienteNombre: cliente.nombre,
      clienteRut: cliente.rut,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})


// Obtener honorarios con filtrado opcional por rango de fechas
router.get('/', verifyToken, checkRole(['ADMIN', 'USER', 'FACTURACION']), async (req, res) => {
  const { year, month, startDate, endDate } = req.query;

  let filter = {};

  if (startDate && endDate) {
    filter.fechaEmision = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  } else if (year && month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    filter.fechaEmision = {
      $gte: start,
      $lt: end,
    };
  }

  try {
    const honorarios = await Honorario.find(filter);
    // console.log(honorarios);

    // Obtener todos los clientes únicos de los honorarios encontrados
    const ruts = [...new Set(honorarios.map(h => h.clienteRut))];
    const clientes = await Cliente.find({ rut: { $in: ruts } });

    // Crear un mapa de RUT a datos de cliente
    const clientesMap = {};
    clientes.forEach(cliente => {
      clientesMap[cliente.rut] = cliente.nombre;
    });

    // Agregar el nombre del cliente a cada honorario
    const honorariosConCliente = honorarios.map(honorario => ({
      ...honorario.toObject(),
      clienteNombre: clientesMap[honorario.clienteRut] || 'Desconocido',
    }));

    res.json(honorariosConCliente);
  } catch (error) {
    console.error('Error al obtener los honorarios:', error);
    res.status(500).json({ message: 'Error al obtener los honorarios' });
  }
})


// Ruta para pagar masivamente honorarios
router.put('/pagar-masivo', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { honorarioIds } = req.body;

   // Agregar logging para verificar el contenido de req.body
  //console.log('Received pagar-masivo request with honorarioIds:', honorarioIds);

  if (!Array.isArray(honorarioIds) || honorarioIds.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron IDs de honorarios.' });
  }

  // Validar que todos los IDs sean válidos ObjectId
  const esValido = honorarioIds.every(id => mongoose.Types.ObjectId.isValid(id));
  //console.log('All honorarioIds valid:', esValido);
  if (!esValido) {
    return res.status(400).json({ error: 'Algunos IDs de honorarios son inválidos.' });
  }

  try {
    // Verificar que todos los honorarios existen
    const honorarios = await Honorario.find({ _id: { $in: honorarioIds } });
    //console.log('Found honorarios:', honorarios.length);
    if (honorarios.length !== honorarioIds.length) {
      return res.status(400).json({ error: 'Algunos honorarios no fueron encontrados.' });
    }

    // Actualizar los honorarios a estado 'pagada' y asignar fechaPago
    const result = await Honorario.updateMany(
       { _id: { $in: honorarioIds }, estado: { $ne: 'pagada' } },
       [
        {
          $set: {
            estado: 'pagada',
            fechaPago: new Date(),
            total_abonado: "$monto" // Referencia al campo 'monto' del documento
          }
        }
      ]
     );
 
     res.json({
      message: `${result.modifiedCount} honorario(s) actualizado(s) a pagada.`,
      modifiedCount: result.modifiedCount
       });
  } catch (error) {
    console.error('Error al pagar masivamente honorarios:', error);
    res.status(500).json({ error: 'Error al pagar masivamente honorarios.', detalles: error.message });
  }
});



// Actualizar un honorario existente por ID
router.put('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;
  const { clienteRut, descripcion, fechaEmision, fechaPago, estado, monto } = req.body;

  try {
    // 1. Verificar si el cliente con el RUT dado existe
    const clienteExistente = await Cliente.findOne({ rut: clienteRut });
    if (!clienteExistente) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    // 2. Obtener el honorario actual
    const honorarioActual = await Honorario.findById(id);
    if (!honorarioActual) {
      return res.status(404).json({ error: 'Honorario no encontrado' });
    }

    // 3. Preparar los campos a actualizar
    const camposActualizacion = {
      clienteRut: clienteExistente.rut,
      descripcion,
      fechaEmision,
      fechaPago,
      estado,
      monto,
    };

    // Calcular la suma de los abonos existentes para este honorario
    const sumAbonosResult = await AbonoHonorario.aggregate([
      { $match: { honorario_id: honorarioActual._id } },
      { $group: { _id: null, total: { $sum: '$monto' } } },
    ]);

    const totalAbonado = sumAbonosResult[0]?.total || 0;

    //console.log(`Suma de abonos para el honorario ${id}: ${totalAbonado}`);

    // Manejar fechas dependiendo del estado
    if (estado === 'pagada') {
      camposActualizacion.fechaPago = new Date();
      camposActualizacion.total_abonado = monto; // Asignar total_abonado igual al monto si está pagado
    } else if (estado === 'abonada') {
      camposActualizacion.total_abonado = totalAbonado;
      camposActualizacion.fechaPago = null; // Opcional: puedes decidir si mantener o eliminar fechaPago
    } else if (estado === 'pendiente') {
      if (totalAbonado > 0) {
        // Si hay abonos previos, mantener el estado como 'abonada'
        camposActualizacion.estado = 'abonada';
      } else {
        // Si no hay abonos, permitir el estado 'pendiente'
        camposActualizacion.estado = 'pendiente';
      }
      camposActualizacion.total_abonado = totalAbonado; // Esto puede ser 0 o la suma de abonos
      camposActualizacion.fechaPago = null;
    }

    // Validar que `total_abonado` no exceda el `monto`
    if (camposActualizacion.total_abonado > monto) {
      return res.status(400).json({ error: 'El total abonado no puede exceder el monto del honorario.' });
    }

    // Actualizar el honorario en la base de datos
    const honorarioActualizado = await Honorario.findByIdAndUpdate(
      id,
      { $set: camposActualizacion },
      { new: true, runValidators: true }
    );

    if (!honorarioActualizado) {
      return res.status(404).json({ error: 'Honorario no encontrado para actualizar.' });
    }

    // Obtener detalles del cliente
    const cliente = await Cliente.findOne({ rut: honorarioActualizado.clienteRut });
    const honorarioConCliente = {
      ...honorarioActualizado.toObject(),
      clienteNombre: cliente ? cliente.nombre : 'Desconocido',
    };

   res.json(honorarioConCliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }

})





// Actualizar un honorario abonado existente por ID
router.put('/abonar/:honorarioId', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { honorarioId } = req.params;
  const { monto } = req.body;

  try {
    const honorarioExistente = await Honorario.findById(honorarioId);
    if (!honorarioExistente) {
      return res.status(404).json({ error: 'Honorario no encontrado' });
    }

    // Actualizar el total abonado
    honorarioExistente.total_abonado += monto;

    // Validar que total_abonado no exceda el monto del honorario
    if (honorarioExistente.total_abonado > honorarioExistente.monto) {
      return res.status(400).json({ error: 'El total abonado no puede exceder el monto del honorario.' });
    }

    // Actualizar el estado si es necesario
    if (honorarioExistente.total_abonado === honorarioExistente.monto) {
      honorarioExistente.estado = 'pagada';
      honorarioExistente.fechaPago = new Date();
    } else if (honorarioExistente.total_abonado > 0) {
      honorarioExistente.estado = 'abonada';
    }

    const honorarioActualizado = await honorarioExistente.save();

    // Obtener detalles del cliente
    const cliente = await Cliente.findOne({ rut: honorarioActualizado.clienteRut });
    const honorarioConCliente = {
      ...honorarioActualizado.toObject(),
      clienteNombre: cliente ? cliente.nombre : 'Desconocido',
    };

    res.json(honorarioConCliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})


// Ruta para eliminar masivamente honorarios
router.delete('/eliminar-masivo', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { honorarioIds } = req.body;

  if (!Array.isArray(honorarioIds) || honorarioIds.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron IDs de honorarios.' });
  }

  try {
    const result = await Honorario.deleteMany({ _id: { $in: honorarioIds } });

    res.json({
      message: `${result.deletedCount} honorario(s) eliminado(s) exitosamente.`,
    });
  } catch (error) {
    console.error('Error al eliminar masivamente honorarios:', error);
    res.status(500).json({ error: 'Error al eliminar masivamente honorarios.' });
  }
});


// Eliminar un honorario por su ID
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'FACTURACION']), async (req, res) => {
  const { id } = req.params;

  try {
    const honorario = await Honorario.findById(id);

    if (!honorario) {
      return res.status(404).json({ error: 'Honorario no encontrado.' });
    }

    await honorario.deleteOne();

    res.json({ message: 'Honorario y abonos eliminados exitosamente', honorario });
  } catch (error) {
    console.error('Error al eliminar el honorario:', error);
    res.status(400).json({ error: error.message });
  }
})





module.exports = router;
