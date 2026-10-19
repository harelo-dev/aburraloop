# Supuestos del modelo

AburráLoop es una simulación con **datos sintéticos**. Nada aquí viene de una operación real. Cada número de abajo es un supuesto editable en `src/sim/simulate.ts`; los que están en la interfaz se mueven con sliders.

## Qué se simula

Un día de despachos de última milla con pago contra entrega (COD) en los 10 municipios del Valle de Aburrá.

1. Se calcula cuántos paquetes fallan: `despachos × tasa de novedad`.
2. Cada paquete fallido se ubica en un municipio según su peso comercial, con dispersión gaussiana alrededor de su centro (σ entre 1,5 y 3,5 km), y se ajusta a la celda de ~1 km más cercana de la matriz de viaje.
3. Cada fallo recibe una hora (08:00–16:30), un valor COD ($85k–$150k) y un grado de potencial de triaje.
4. Una mini-van intercepta un paquete si el **tiempo por carretera** desde su ubicación es menor o igual al máximo configurado, el grado es A o B y la van no superó su capacidad del día.
5. Un paquete interceptado se salva con cierta probabilidad. Si no se salva, vuelve al CEDI igual.

## Parámetros

| Supuesto | Valor | Dónde |
| --- | --- | --- |
| Peso de envíos | Medellín 48%, Norte 24%, Sur 28% | `src/data/places.json` |
| Mezcla de fallos | 45% Grado A, 25% Grado B, 30% Grado C | `ASSUMPTIONS.gradeShare` |
| Éxito 2.º intento, Grado A | 60% (slider 30–90%) | UI |
| Éxito liquidación flash, Grado B | 80% | `ASSUMPTIONS.gradeBSuccess` |
| Margen recuperado | 28% del COD (A), 12% (B) | `marginA`, `marginB` |
| Flete ahorrado | $900 por km, ida y vuelta al CEDI, más $4.000 de manejo | `freightCopPerKm`, `handlingCop` |
| Costo de una van | $320.000 por día | `vanCostCopPerDay` |
| Capacidad de una van | 80 paquetes por día | `vanCapacity` |
| Tiempo máximo van → paquete | 25 min (slider 10–45) | UI |

## Matriz de tiempos de viaje

`src/data/travel.json` guarda, para una malla de ~1 km sobre el valle (443 celdas), el tiempo y la distancia por carretera desde cada ubicación de van y cada CEDI. Se generó una sola vez con `npm run build:matrix`, que consulta el servidor demo público de OSRM (perfil de carro). La app no llama a ningún servicio de rutas en vivo.

Limitaciones: es tiempo de carro sin tráfico por hora del día, y las motos suelen ser más rápidas en trancón. Las líneas rojas del mapa son rectas y solo ilustran el viaje de retorno; el flete ahorrado sí usa la distancia por carretera.

## Lo que el modelo no hace todavía

- Las vans están fijas por zona (Norte, Centro, Sur). No se mueven durante el día.
- No hay variación de tráfico por hora.
- Los grados A, B y C son una proporción fija, no una clasificación de paquetes reales.
- Los costos son estimaciones redondas, no cotizaciones.

## Cómo calibrarlo con datos reales

Con 30 días de intentos fallidos de una operación (hora, dirección, motivo, valor y desenlace del reintento) se reemplazan la mezcla de grados, la tasa de éxito del segundo intento y la distribución espacial. La estructura del código ya separa esos supuestos del motor.
