# CreditFlash
## Manual de Usuario Unificado
**Versión:** v2.1  
**Fecha:** 04/14/2026  
**Audiencia:** Usuarios finales, analistas y supervisores

---

## Índice
1. Introducción  
2. Acceso al sistema  
3. Flujo operativo recomendado  
4. Menú principal  
5. Módulo Clientes  
6. Dashboard del cliente  
7. Módulo Solicitudes  
8. Nuevo caso (flujo unificado)  
9. Registro de cuotas  
10. Reportes  
11. Carga de datos bancarios  
12. Logs (auditoría)  
13. Permisos y accesos  
14. Actualizaciones recientes (Abril 2026)  
15. Glosario  
16. Capturas sugeridas

---

## 1. Introducción
CreditFlash es una plataforma para gestionar clientes, solicitudes de crédito, préstamos, pagos, reportes y trazabilidad de acciones.

Este manual está diseñado para ayudarte a operar el sistema con seguridad y orden, paso a paso.

### Qué aprenderás en este manual
- Qué hace cada módulo.
- Qué revisar antes de aprobar o registrar pagos.
- Errores comunes y cómo evitarlos.
- Buenas prácticas para trabajar sin duplicidades.

---

## 2. Acceso al sistema
### 2.1 Inicio de sesión
- Ingresa **Email** y **Contraseña**.
- Haz clic en **Ingresar**.

### Resultado esperado
- Acceso a la pantalla principal según tu rol.

### Si no puedes entrar
- Verifica correo/contraseña.
- Revisa si tu sesión expiró.
- Si faltan módulos, normalmente es por permisos del rol.

---

## 3. Flujo operativo recomendado
Para evitar errores, trabaja siempre en este orden:

1. Buscar cliente (nombre, teléfono o correo).  
2. Si no existe, crear cliente.  
3. Validar estado del cliente.  
4. Crear solicitud.  
5. Ejecutar modelo.  
6. Revisar score, riesgo y capacidad de pago.  
7. Decidir: aprobar, condicionar o rechazar.  
8. Si se aprueba, generar préstamo y cuotas.

**Regla clave:** No aprobar una solicitud sin ejecutar primero el modelo.

---

## 4. Menú principal
El menú lateral muestra opciones según el rol.

- **Inicio / Analytics:** indicadores generales.
- **Clientes:** alta, edición y seguimiento.
- **Operación:** nuevo caso, solicitudes, cuotas.
- **Reportes:** análisis operativo y financiero.
- **Carga de datos bancarios:** importación masiva.
- **Administración:** permisos y logs (generalmente admin).

---

## 5. Módulo Clientes
### 5.1 Listado de clientes
- Usa filtros por nombre y estado.
- Acciones típicas: **Ver**, **Editar**, **Cambiar estado**.

**Buena práctica:** Busca antes de crear para evitar duplicados.

### 5.2 Estados del cliente
- **ACTIVO:** puede operar.
- **SUSPENDIDO:** pausa temporal por revisión.
- **INACTIVO:** requiere validación o reactivación.
- **BLOQUEADO:** no puede continuar proceso.

### 5.3 Crear/Editar cliente
Datos principales:
- Nombre y apellido
- Teléfono
- Email

Datos opcionales:
- Contacto alterno
- Referido
- Documento de identidad (PDF)

Resultado esperado:
- El cliente queda visible en el listado y disponible para solicitudes.

---

## 6. Dashboard del cliente
Aquí revisas todo el caso en un solo lugar:

- **Dashboard:** resumen general.
- **Préstamos:** historial y estado.
- **Pagos:** cuotas y movimientos.
- **Documentos:** archivos del cliente y solicitud.

---

## 7. Módulo Solicitudes
En esta pantalla se decide el crédito.

Acciones:
- **Ver**
- **Editar**
- **Ejecutar modelo**
- **Aprobar**
- **Rechazar**

**Regla clave:** aprobar solo cuando documentación y modelo estén completos.

---

## 8. Nuevo caso (flujo unificado)
Proceso guiado para crear cliente y solicitud en un mismo flujo.

Pasos:
1. Cliente  
2. Condiciones del crédito  
3. Modelos  
4. Documento de identidad  
5. Estado de cuenta / comprobantes

Botones:
- **Siguiente / Anterior**
- **Publicar solicitud**

Errores frecuentes:
- Falta de documentos PDF.
- Campos obligatorios vacíos.
- Inconsistencias entre cliente y solicitud.

---

## 9. Registro de cuotas
Permite registrar pagos en préstamos activos y consultar historial.

Acciones:
- Registrar pago
- Ver historial
- Ver detalle
- Notificar (correo/WhatsApp, según permisos)

### 9.1 Popup de pago
Campos comunes:
- Monto de pago
- Penalización
- Cargo extra (fee)

Comportamiento:
- **Pago parcial:** queda saldo pendiente.
- **Pago completo:** cuota cerrada.
- **Sobrepago:** puede aplicarse a cuotas siguientes.

---

## 10. Reportes
Sirven para control operativo y financiero.

Reportes frecuentes:
- Ganancias esperadas vs cobradas
- Saldo pendiente por cliente
- Comparativo año contra año
- Top moras diarias

Flujo:
1. Seleccionar tipo
2. Definir rango de fechas
3. Generar reporte

---

## 11. Carga de datos bancarios
Sube archivos Excel/CSV para registrar pagos masivos.

Pasos:
1. Seleccionar archivo
2. Cargar
3. Revisar resultados

Resultado esperado:
- El sistema muestra filas válidas, inválidas y duplicadas.

---

## 12. Logs (auditoría)
Registra trazabilidad de acciones:
- Qué cambió
- Quién lo hizo
- Cuándo ocurrió

Generalmente visible para administradores.

---

## 13. Permisos y accesos
Los permisos definen qué puede ver o hacer cada rol.

- Analista: operación diaria según configuración.
- Supervisor: revisión y control ampliado.
- Administrador: acceso total, permisos y auditoría.

Si un botón no aparece, revisa permisos del rol.

---

## 14. Actualizaciones recientes (Abril 2026)
### Clientes
- Carga opcional de documento de identidad (PDF).
- Documento visible en Dashboard del cliente > Documentos.

### Nuevo caso
- Flujo más detallado y validaciones claras.
- Carga de documentos:
  - Identidad: 1 PDF
  - Estados de cuenta: 1 a 4 PDFs
  - Comprobantes de ingresos: 1 a 4 PDFs

### Registro de cuotas
- Se muestra saldo pendiente en la tabla.
- Mejoras de pago parcial/sobrepago.
- Soporte de penalización y fee.

### Reportes y datos bancarios
- Carga bancaria integrada en menú lateral.
- Filtros y resumen de procesamiento.

### Permisos
- Control granular para notificaciones y módulos sensibles.

---

## 15. Glosario
- **Solicitud:** petición de crédito.  
- **Préstamo:** crédito aprobado.  
- **Cuota:** pago periódico del préstamo.  
- **Saldo pendiente:** monto que falta pagar.  
- **Mora:** atraso en el pago.

---

## 16. Capturas sugeridas
Para una versión final visual, incluir capturas en este orden:
1. Login  
2. Menú principal  
3. Listado de clientes  
4. Formulario de cliente  
5. Listado de solicitudes  
6. Ejecutar modelo  
7. Aprobación  
8. Nuevo caso  
9. Dashboard del cliente  
10. Registro de cuotas (tabla y popup)  
11. Reportes  
12. Carga de datos bancarios  
13. Logs
