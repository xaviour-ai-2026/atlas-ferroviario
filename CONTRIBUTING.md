# Cómo contribuir a Atlas Ferroviario

Gracias por querer ayudar. Este es un proyecto ciudadano, gratuito y sin ánimo de lucro de observación del
ferrocarril con datos públicos. **No es un sistema de seguridad** y ninguna contribución puede convertirlo en uno.

## Qué es bienvenido

- Correcciones de datos y errores, con la evidencia: número de tren, hora, fichero de Renfe o enlace oficial.
- Mejoras de precisión, accesibilidad, rendimiento o claridad del texto.
- Revisión técnica por profesionales del ferrocarril, investigadores y personas usuarias.

## Reglas del proyecto

1. **Solo datos con licencia abierta y fuente citada.** No uses visores o API no documentadas de Renfe u otros
   operadores, ni copies código sin una licencia compatible.
2. **Nunca inventes datos.** No interpoles posiciones, no dibujes rectas como vía y no rellenes huecos en silencio.
   Si dos datos se contradicen, se muestran ambos y se avisa.
3. **Nada de lógica de seguridad.** Nada de predicción de colisiones, recomendaciones de frenado, afirmaciones de
   ocupación de vía, velocidades sin hora de medición fiable, ni mensajes que sugieran que la ausencia de avisos
   equivale a seguridad.
4. **Accidentes: respeto y fuentes oficiales.** El proyecto no reinterpreta investigaciones ni señala culpables.
   Cualquier mención debe citar documentos oficiales (AITAT/CIAF, Ministerio) y distinguir lo confirmado de lo
   preliminar. No publiques datos personales de víctimas ni de profesionales.
5. **Sin dependencias nuevas sin acuerdo previo.** Versiones exactas y verificadas; ver `public/vendor/VENDOR.md`.
6. **Pruebas.** `npm test` debe pasar. Si cambias el tratamiento de datos, añade una prueba y, si puedes, ejecuta
   `node scripts/validate.mjs 100` en horario diurno.

## Cómo proponer un cambio

Abre una incidencia describiendo el problema y la evidencia, o una propuesta de cambio pequeña y enfocada que
explique qué cambia, por qué, y cómo lo has comprobado.

## Normas de convivencia

- Trato respetuoso y profesional; críticas sobre el trabajo, nunca sobre las personas.
- Sin acoso, insultos, discriminación ni contenido político o partidista.
- Especial cuidado al hablar de los accidentes: hay familias y profesionales afectados.
- Las personas que mantienen el proyecto pueden editar, ocultar o rechazar contribuciones que incumplan estas normas.
  Para avisar de un problema de convivencia, abre una incidencia o contacta con quienes mantienen el proyecto.

Al contribuir aceptas que tu código se publique bajo la licencia MIT del proyecto.
